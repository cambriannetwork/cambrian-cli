import type { BaseClientOptions, RateLimitInfo, ApiErrorOptions } from './types.js';

function parseOptionalInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalUnixTimestamp(value: string | null): string | null {
  const parsed = parseOptionalInt(value);
  if (parsed === null) return null;
  return new Date(parsed * 1e3).toISOString();
}

export function parseRateLimitInfo(headers: Headers): RateLimitInfo | null {
  const info: RateLimitInfo = {
    limit: parseOptionalInt(headers.get('X-RateLimit-Limit')),
    remaining: parseOptionalInt(headers.get('X-RateLimit-Remaining')),
    resetAt: parseOptionalUnixTimestamp(headers.get('X-RateLimit-Reset')),
    retryAfterSeconds: parseOptionalInt(headers.get('Retry-After')),
  };
  return Object.values(info).some((v) => v !== null) ? info : null;
}

/**
 * Default per-request timeout in milliseconds. Set to 90s because several
 * legitimate endpoints (single-pool details, high-volume Solana queries like
 * traders-leaderboard) routinely take 30-60s+ under load; a lower default
 * produced avoidable 408s on valid requests. Override per call with --timeout.
 */
export const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Maps an HTTP status (and an optional server-provided code) to a stable,
 * machine-readable error code. Prefers the server's own code when present.
 */
export function mapStatusToCode(status: number, parsedCode?: string | null): string {
  if (parsedCode && parsedCode.trim().length > 0) return parsedCode.trim();
  switch (status) {
    case 401:
      return 'AUTH_REQUIRED';
    case 403:
      return 'AUTH_FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 408:
      return 'TIMEOUT';
    case 429:
      return 'RATE_LIMITED';
    case 400:
    case 422:
      return 'BAD_REQUEST';
    default:
      if (status >= 500) return 'UPSTREAM_ERROR';
      return 'HTTP_ERROR';
  }
}

/** Whether a request with the given status is worth retrying. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

// ── Retry backoff ───────────────────────────────────────────────────────
/** Base backoff delay in milliseconds (doubles each attempt). */
export const RETRY_BASE_MS = 500;
/** Upper bound on the computed exponential backoff (before Retry-After). */
export const RETRY_CAP_MS = 20_000;
/** Absolute ceiling on any single backoff, including a server `Retry-After`. */
export const RETRY_MAX_DELAY_MS = 60_000;

/**
 * Computes the backoff delay before the next retry, using AWS-style truncated
 * exponential backoff with full jitter: `random() * min(cap, base * 2^attempt)`.
 * If the server provided a `Retry-After` (seconds), the delay is at least that
 * long. The result is always clamped to `RETRY_MAX_DELAY_MS`.
 *
 * @param attempt           zero-based retry index (0 for the first retry)
 * @param retryAfterSeconds value of the `Retry-After` header, if any
 * @param random            injectable RNG (defaults to Math.random) for testing
 */
export function computeBackoffMs(
  attempt: number,
  retryAfterSeconds: number | null = null,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
  let delay = random() * ceiling;
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    delay = Math.max(delay, retryAfterSeconds * 1000);
  }
  return Math.round(Math.min(delay, RETRY_MAX_DELAY_MS));
}

export class ApiError extends Error {
  status: number;
  code: string | null;
  body: string;
  rateLimit: RateLimitInfo | null;
  retryable: boolean;
  /** Raw upstream body, for debugging only (never surfaced to users). */
  rawBody: string;

  constructor(opts: ApiErrorOptions) {
    super(`API error ${opts.status}: ${opts.message}`);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.body = opts.body;
    this.rateLimit = opts.rateLimit;
    this.retryable = opts.retryable ?? isRetryableStatus(opts.status);
    this.rawBody = opts.rawBody ?? opts.body;
  }
}

export class BaseClient {
  protected apiKey: string;
  protected baseUrl: string;
  protected fetchFn: typeof globalThis.fetch;
  protected timeoutMs: number;
  protected maxRetries: number;

  constructor(opts: BaseClientOptions & { defaultBaseUrl: string }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? opts.defaultBaseUrl).replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 0);
  }

  /**
   * Issues a request, retrying transient failures (408/429/5xx and network
   * errors) up to `maxRetries` times with jittered exponential backoff that
   * honors `Retry-After`. With the default `maxRetries: 0` this is a single
   * attempt — behavior is unchanged for callers that don't opt in.
   */
  protected async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.attempt<T>(path, init);
      } catch (err) {
        if (attempt >= this.maxRetries || !this.isRetryableError(err)) throw err;
        const retryAfter =
          err instanceof ApiError ? err.rateLimit?.retryAfterSeconds ?? null : null;
        await this.delay(computeBackoffMs(attempt, retryAfter));
      }
    }
  }

  /** Whether a thrown error is a transient failure worth retrying. */
  private isRetryableError(err: unknown): boolean {
    if (err instanceof ApiError) return err.retryable;
    // Non-ApiError throws reaching here are network/fetch failures (the timeout
    // abort is already converted to a retryable ApiError below) — retry them.
    return true;
  }

  /** Awaitable delay. Extracted so tests can stub it. */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async attempt<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('X-API-KEY', this.apiKey);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const controller = new AbortController();
    const timer = this.timeoutMs > 0
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : undefined;

    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? controller.signal,
      });
    } catch (err) {
      if (timer !== undefined) clearTimeout(timer);
      if (this.isAbortError(err)) {
        throw new ApiError({
          status: 408,
          code: 'TIMEOUT',
          message: `Request timed out after ${this.timeoutMs}ms.`,
          body: '',
          rateLimit: null,
          retryable: true,
          rawBody: '',
        });
      }
      throw err;
    }
    if (timer !== undefined) clearTimeout(timer);

    if (!res.ok) {
      const errorBody = await this.extractErrorBody(res);
      throw new ApiError({
        status: res.status,
        code: mapStatusToCode(res.status, errorBody.code),
        message: errorBody.message,
        body: errorBody.rawBody,
        rateLimit: parseRateLimitInfo(res.headers),
        retryable: isRetryableStatus(res.status),
        rawBody: errorBody.rawBody,
      });
    }

    const payload = await res.json() as T;
    Object.defineProperty(payload as object, '_rateLimit', {
      value: parseRateLimitInfo(res.headers),
      enumerable: false,
      configurable: true,
      writable: false,
    });
    return payload;
  }

  private isAbortError(err: unknown): boolean {
    return (
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'TimeoutError')
    );
  }

  private async extractErrorBody(
    res: Response,
  ): Promise<{ message: string; code: string | null; rawBody: string }> {
    const rawBody = await res.text().catch(() => '');
    const trimmed = rawBody.trim();
    if (trimmed.length === 0) {
      return { message: 'Unknown error', code: null, rawBody: '' };
    }

    // Never surface raw HTML (e.g. upstream gateway/proxy error pages). Detect
    // it via content-type or a leading HTML marker and return a generic
    // message; keep the raw body for debugging only.
    const contentType = res.headers.get('content-type') ?? '';
    const looksLikeHtml =
      contentType.toLowerCase().includes('text/html') ||
      /^\s*(<!doctype html|<html)/i.test(trimmed);
    if (looksLikeHtml) {
      return {
        message: `Upstream returned a non-JSON (HTML) error response (HTTP ${res.status}).`,
        code: null,
        rawBody: trimmed,
      };
    }

    try {
      const parsed = JSON.parse(trimmed);
      const code = parsed.code ? `[${parsed.code}] ` : '';
      return {
        message: `${code}${parsed.error?.trim?.() || parsed.message?.trim?.() || trimmed}`,
        code: parsed.code?.trim?.() || null,
        rawBody: trimmed,
      };
    } catch {
      return { message: trimmed, code: null, rawBody: trimmed };
    }
  }

  protected buildParams(entries: object): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, String(v));
      } else {
        params.set(key, String(value));
      }
    }
    return params.toString();
  }
}
