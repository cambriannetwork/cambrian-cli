/**
 * x402 pay-and-fetch flow. The actual payment is handled by the official
 * `@x402/*` v2 SDK (the same library family the gateway's server runs, so it's
 * wire-compatible), lazily imported alongside viem. We add an unpaid pre-flight
 * probe to power the spend cap + cost preview + explicit `--yes`, and register a
 * defense-in-depth `PaymentPolicy` so the SDK itself refuses anything over cap.
 *
 * Nothing here is bundled: the SDK + viem are devDependencies, external in the
 * esbuild build, and imported on demand — so the core CLI stays zero-dep.
 */

import { CliUsageError } from '../cli/core.js';
import {
  parsePaymentRequired,
  selectRequirement,
  assertWithinCap,
  requirementAmount,
  formatUsd,
  type PaymentRequirement,
} from './payment.js';

export const X402_SDK_INSTALL_COMMAND = 'npm install -g @x402/core @x402/fetch @x402/evm viem';
export const DEFAULT_X402_TIMEOUT_MS = 90_000;

/** Normalizes/validates a 32-byte hex private key (0x-prefixed). */
export function normalizePrivateKey(raw: string): `0x${string}` {
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new CliUsageError(
      'CAMBRIAN_X402_PRIVATE_KEY must be a 32-byte hex private key (0x + 64 hex chars).',
    );
  }
  return hex as `0x${string}`;
}

/** A payment-wrapped fetch (from the SDK) that auto-settles 402s. */
export type PayFetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Lazily loads viem + the @x402 SDK and returns a payment-wrapped fetch bound to
 * `baseFetch`. A `capMicro` policy makes the SDK refuse any option over the cap.
 */
export async function loadPayFetch(
  privateKey: string,
  baseFetch: typeof globalThis.fetch,
  capMicro: number,
): Promise<PayFetch> {
  const normalized = normalizePrivateKey(privateKey);
  let accounts: typeof import('viem/accounts');
  let core: typeof import('@x402/core/client');
  let evm: typeof import('@x402/evm/exact/client');
  let fetchMod: typeof import('@x402/fetch');
  try {
    accounts = await import('viem/accounts');
    core = await import('@x402/core/client');
    evm = await import('@x402/evm/exact/client');
    fetchMod = await import('@x402/fetch');
  } catch {
    throw new CliUsageError(
      'x402 payments require the x402 SDK, which is not installed.\n' +
        `Install it alongside the CLI:  ${X402_SDK_INSTALL_COMMAND}`,
    );
  }

  const signer = accounts.privateKeyToAccount(normalized);
  const client = new core.x402Client();
  client.register('eip155:*', new evm.ExactEvmScheme(signer));
  // Defense in depth: never let the SDK settle an option above the cap.
  client.registerPolicy((_v, requirements) =>
    requirements.filter((r) => {
      const amount = (r as PaymentRequirement).amount ?? (r as PaymentRequirement).maxAmountRequired;
      return amount !== undefined && Number(amount) <= capMicro;
    }),
  );

  return fetchMod.wrapFetchWithPayment(baseFetch, client) as unknown as PayFetch;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

function timeoutMessage(phase: 'probe' | 'paid', timeoutMs: number): string {
  if (phase === 'paid') {
    return (
      `x402: paid request timed out after ${timeoutMs}ms. ` +
      'Payment status may be unknown; check your wallet activity before retrying.'
    );
  }
  return `x402: unpaid gateway probe timed out after ${timeoutMs}ms.`;
}

async function fetchWithTimeout(
  fetchFn: PayFetch,
  url: string,
  timeoutMs: number,
  phase: 'probe' | 'paid',
  headers?: RequestInit['headers'],
): Promise<Response> {
  const init: RequestInit = { method: 'GET', ...(headers ? { headers } : {}) };
  if (timeoutMs === 0) {
    return fetchFn(url, init);
  }

  const controller = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error(timeoutMessage(phase, timeoutMs));
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface PayResult {
  paid: boolean;
  status: number;
  body: unknown;
  receipt?: string | null;
}

export interface PayOptions {
  fetch: typeof globalThis.fetch;
  url: string;
  /** Builds the SDK-wrapped fetch; called only after authorization. */
  getPayFetch: () => Promise<PayFetch>;
  capMicro: number;
  /** Return false to abort before paying. */
  authorize: (req: PaymentRequirement) => boolean;
  /** Called once the price is known, before authorization (cost preview). */
  onPreview?: (req: PaymentRequirement) => void;
  /** Per-request timeout in milliseconds. Set 0 to disable. */
  timeoutMs?: number;
  /**
   * Called immediately before the SDK-paid request starts. Use this to attach
   * idempotency headers and record a local pending attempt. `onSuccess` means
   * the caller received data; `onRejected` means the gateway rejected payment
   * before settlement; `onUnknown` means the caller must not assume whether the
   * authorization settled.
   */
  preparePayment?: (req: PaymentRequirement) => {
    headers?: RequestInit['headers'];
    onSuccess?: () => void;
    onRejected?: () => void;
    onUnknown?: () => void;
  };
}

/**
 * Probes `url` unpaid to learn the price; enforces the cap; previews; and — only
 * if authorized — pays via the SDK-wrapped fetch and returns the body + receipt.
 */
export async function payAndFetch(opts: PayOptions): Promise<PayResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_X402_TIMEOUT_MS;
  const probe = await fetchWithTimeout(opts.fetch, opts.url, timeoutMs, 'probe');

  if (probe.status !== 402) {
    const body = await readBody(probe);
    if (!probe.ok) {
      throw new Error(`x402 gateway returned ${probe.status} (expected 402 or 200).`);
    }
    return { paid: false, status: probe.status, body }; // not paywalled
  }

  const req = selectRequirement(parsePaymentRequired(await readBody(probe)));
  assertWithinCap(req, opts.capMicro);

  opts.onPreview?.(req);
  if (!opts.authorize(req)) {
    throw new CliUsageError(
      `x402: payment of ${formatUsd(requirementAmount(req))} not authorized. Re-run with --yes to pay.`,
    );
  }

  const payFetch = await opts.getPayFetch();
  const attempt = opts.preparePayment?.(req);
  let paidRes: Response;
  try {
    paidRes = await fetchWithTimeout(payFetch, opts.url, timeoutMs, 'paid', attempt?.headers);
  } catch (err) {
    attempt?.onUnknown?.();
    throw err;
  }
  const body = await readBody(paidRes);
  if (!paidRes.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    if (paidRes.status === 402 || paidRes.status === 403) {
      attempt?.onRejected?.();
      throw new Error(`x402: payment rejected by gateway (${paidRes.status}). ${detail}`);
    }
    attempt?.onUnknown?.();
    throw new Error(
      `x402: paid request failed after payment submission (${paidRes.status}). ` +
        `Payment status may be unknown; check your wallet activity before retrying. ${detail}`,
    );
  }

  attempt?.onSuccess?.();
  return {
    paid: true,
    status: paidRes.status,
    body,
    receipt: paidRes.headers.get('payment-response') ?? paidRes.headers.get('x-payment-response'),
  };
}
