/**
 * Tests for automatic retry with jittered exponential backoff (BaseClient) and
 * the pure computeBackoffMs helper. Uses an injected fetch + a stubbed delay so
 * no live API is hit and no real time elapses.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { CambrianData } from '../src/client/index.js';
import {
  ApiError,
  BaseClient,
  computeBackoffMs,
  RETRY_BASE_MS,
  RETRY_CAP_MS,
  RETRY_MAX_DELAY_MS,
} from '../src/client/base-client.js';

// A fetch that yields a queued sequence of outcomes (Response or thrown error),
// counting how many times it was called.
function fetchSequence(outcomes: Array<{ status: number; body?: string } | Error>) {
  let calls = 0;
  const fn = (async () => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls += 1;
    if (outcome instanceof Error) throw outcome;
    return new Response(outcome.body ?? '{}', {
      status: outcome.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fn, getCalls: () => calls };
}

describe('computeBackoffMs', () => {
  it('full jitter scales with attempt and is bounded by the cap', () => {
    // random()=1 yields the full ceiling = min(cap, base * 2^attempt)
    expect(computeBackoffMs(0, null, () => 1)).toBe(RETRY_BASE_MS);
    expect(computeBackoffMs(1, null, () => 1)).toBe(RETRY_BASE_MS * 2);
    expect(computeBackoffMs(2, null, () => 1)).toBe(RETRY_BASE_MS * 4);
    // A high attempt is clamped to the cap.
    expect(computeBackoffMs(20, null, () => 1)).toBe(RETRY_CAP_MS);
  });

  it('random()=0 gives a zero base delay', () => {
    expect(computeBackoffMs(3, null, () => 0)).toBe(0);
  });

  it('honors Retry-After as a floor', () => {
    expect(computeBackoffMs(0, 2, () => 0)).toBe(2000);
    // jitter above the Retry-After still wins
    expect(computeBackoffMs(2, 0.1, () => 1)).toBe(RETRY_BASE_MS * 4);
  });

  it('clamps everything to the absolute max delay', () => {
    expect(computeBackoffMs(0, 999, () => 0)).toBe(RETRY_MAX_DELAY_MS);
  });
});

describe('BaseClient retry behavior', () => {
  afterEach(() => vi.restoreAllMocks());

  function clientWith(fetch: typeof globalThis.fetch, maxRetries: number): CambrianData {
    // Stub the backoff sleep so retries don't actually wait.
    vi.spyOn(BaseClient.prototype as unknown as { delay: (ms: number) => Promise<void> }, 'delay')
      .mockResolvedValue(undefined);
    return new CambrianData({ apiKey: 'test-key', fetch, maxRetries });
  }

  it('does not retry by default (maxRetries: 0)', async () => {
    const seq = fetchSequence([{ status: 500 }, { status: 200 }]);
    const client = new CambrianData({ apiKey: 'k', fetch: seq.fn });
    const err = await client.opabinia.query('/latest-block').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(seq.getCalls()).toBe(1);
  });

  it('retries a 500 then succeeds', async () => {
    const seq = fetchSequence([{ status: 500 }, { status: 200, body: '{"ok":true}' }]);
    const client = clientWith(seq.fn, 2);
    const result = await client.opabinia.query('/latest-block');
    expect(result).toMatchObject({ ok: true });
    expect(seq.getCalls()).toBe(2);
  });

  it('exhausts retries and throws the last error', async () => {
    const seq = fetchSequence([{ status: 503 }]);
    const client = clientWith(seq.fn, 2);
    const err = await client.opabinia.query('/latest-block').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(seq.getCalls()).toBe(3); // 1 initial + 2 retries
  });

  it('does not retry a non-retryable 400', async () => {
    const seq = fetchSequence([{ status: 400 }, { status: 200 }]);
    const client = clientWith(seq.fn, 3);
    const err = await client.opabinia.query('/latest-block').then(() => null, (e) => e);
    expect(err.status).toBe(400);
    expect(seq.getCalls()).toBe(1);
  });

  it('retries transient network errors', async () => {
    const netErr = new TypeError('fetch failed');
    const seq = fetchSequence([netErr, { status: 200, body: '{"ok":true}' }]);
    const client = clientWith(seq.fn, 1);
    const result = await client.opabinia.query('/latest-block');
    expect(result).toMatchObject({ ok: true });
    expect(seq.getCalls()).toBe(2);
  });

  it('passes the Retry-After value into the backoff', async () => {
    const delaySpy = vi
      .spyOn(BaseClient.prototype as unknown as { delay: (ms: number) => Promise<void> }, 'delay')
      .mockResolvedValue(undefined);
    const body = JSON.stringify({ message: 'slow down' });
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(body, { status: 429, headers: { 'Retry-After': '2' } });
      }
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const client = new CambrianData({ apiKey: 'k', fetch: fetchFn, maxRetries: 1 });
    await client.opabinia.query('/latest-block');
    // Retry-After: 2s -> at least 2000ms backoff.
    expect(delaySpy).toHaveBeenCalledTimes(1);
    expect(delaySpy.mock.calls[0][0]).toBeGreaterThanOrEqual(2000);
  });
});
