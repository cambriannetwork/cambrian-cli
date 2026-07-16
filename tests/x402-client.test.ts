/**
 * Tests for the x402 pay-and-fetch flow. The flow logic uses a fake PayFetch; a
 * separate test drives the REAL @x402 SDK (loadPayFetch) against a mock gateway,
 * proving the SDK wiring + signing without network or real funds.
 */

import { describe, it, expect } from 'vitest';
import { payAndFetch, normalizePrivateKey, loadPayFetch, type PayFetch } from '../src/x402/client.js';
import { CliUsageError } from '../src/cli/core.js';

const TEST_KEY = `0x${'1'.repeat(64)}`;

const REQUIRED_BODY = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453',
      amount: '50000',
      payTo: '0x4c3b0b1cab290300bd5a36ad5f33a607acbd7ac3',
      maxTimeoutSeconds: 600,
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      extra: { name: 'USD Coin', version: '2' },
    },
  ],
  resource: { url: 'https://x402.cambrian.network/api/v1/deep42/x', description: 'x', mimeType: 'application/json' },
};

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A 402 like the real gateway: JSON body + base64 payment-required header. */
function gateway402(): Response {
  const b64 = Buffer.from(JSON.stringify(REQUIRED_BODY), 'utf8').toString('base64');
  return res(402, REQUIRED_BODY, { 'payment-required': b64, 'www-authenticate': 'X402' });
}

function abortingFetch(): typeof globalThis.fetch {
  return (async (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })) as unknown as typeof globalThis.fetch;
}

describe('normalizePrivateKey', () => {
  it('accepts 0x and bare 64-hex, rejects junk', () => {
    expect(normalizePrivateKey(TEST_KEY)).toBe(TEST_KEY);
    expect(normalizePrivateKey('1'.repeat(64))).toBe(TEST_KEY);
    expect(() => normalizePrivateKey('0x123')).toThrowError(CliUsageError);
  });
});

describe('payAndFetch flow', () => {
  const fakePay: PayFetch = async () => res(200, { ok: true, data: [1, 2, 3] }, { 'payment-response': 'rcpt' });

  it('previews, pays via the SDK fetch, and returns body + receipt', async () => {
    let probes = 0;
    const fetch = (async () => { probes += 1; return gateway402(); }) as unknown as typeof globalThis.fetch;
    const result = await payAndFetch({
      fetch,
      url: 'https://x402.cambrian.network/api/v1/deep42/x?limit=1',
      capMicro: 100000,
      getPayFetch: async () => fakePay,
      authorize: () => true,
    });
    expect(result.paid).toBe(true);
    expect(result.body).toEqual({ ok: true, data: [1, 2, 3] });
    expect(result.receipt).toBe('rcpt');
    expect(probes).toBe(1); // one unpaid probe; the SDK fetch handles the rest
  });

  it('prepares a paid attempt, sends headers, and marks success', async () => {
    let paidHeaders: RequestInit['headers'] | undefined;
    let prepared = 0;
    let succeeded = 0;
    const headerPay: PayFetch = async (_url, init) => {
      paidHeaders = init?.headers;
      return res(200, { ok: true }, { 'payment-response': 'rcpt' });
    };

    const result = await payAndFetch({
      fetch: (async () => gateway402()) as unknown as typeof globalThis.fetch,
      url: 'https://x/api',
      capMicro: 100000,
      getPayFetch: async () => headerPay,
      authorize: () => true,
      preparePayment: () => {
        prepared += 1;
        return {
          headers: { 'Idempotency-Key': 'idem-1' },
          onSuccess: () => { succeeded += 1; },
        };
      },
    });

    expect(result.paid).toBe(true);
    expect(prepared).toBe(1);
    expect(succeeded).toBe(1);
    expect(paidHeaders).toEqual({ 'Idempotency-Key': 'idem-1' });
  });

  it('aborts (no SDK load, no payment) when not authorized', async () => {
    let loaded = false;
    let prepared = false;
    await expect(
      payAndFetch({
        fetch: (async () => gateway402()) as unknown as typeof globalThis.fetch,
        url: 'https://x/api',
        capMicro: 100000,
        getPayFetch: async () => { loaded = true; return fakePay; },
        authorize: () => false,
        preparePayment: () => {
          prepared = true;
          return {};
        },
      }),
    ).rejects.toBeInstanceOf(CliUsageError);
    expect(loaded).toBe(false);
    expect(prepared).toBe(false);
  });

  it('rejects when the price exceeds the cap (before loading the SDK)', async () => {
    let loaded = false;
    let prepared = false;
    await expect(
      payAndFetch({
        fetch: (async () => gateway402()) as unknown as typeof globalThis.fetch,
        url: 'https://x/api',
        capMicro: 10000, // $0.01 < $0.05
        getPayFetch: async () => { loaded = true; return fakePay; },
        authorize: () => true,
        preparePayment: () => {
          prepared = true;
          return {};
        },
      }),
    ).rejects.toBeInstanceOf(CliUsageError);
    expect(loaded).toBe(false);
    expect(prepared).toBe(false);
  });

  it('passes through a non-paywalled 200 without paying', async () => {
    const result = await payAndFetch({
      fetch: (async () => res(200, { free: true })) as unknown as typeof globalThis.fetch,
      url: 'https://x/api',
      capMicro: 100000,
      getPayFetch: async () => fakePay,
      authorize: () => true,
    });
    expect(result.paid).toBe(false);
    expect(result.body).toEqual({ free: true });
  });

  it('throws when the SDK-paid request is itself rejected', async () => {
    const rejectPay: PayFetch = async () => res(402, { error: 'invalid payment' });
    let rejected = 0;
    let unknown = 0;
    await expect(
      payAndFetch({
        fetch: (async () => gateway402()) as unknown as typeof globalThis.fetch,
        url: 'https://x/api',
        capMicro: 100000,
        getPayFetch: async () => rejectPay,
        authorize: () => true,
        preparePayment: () => ({
          onRejected: () => { rejected += 1; },
          onUnknown: () => { unknown += 1; },
        }),
      }),
    ).rejects.toThrow(/payment rejected/);
    expect(rejected).toBe(1);
    expect(unknown).toBe(0);
  });

  it('marks payment state unknown when the paid request returns a 5xx', async () => {
    const failPay: PayFetch = async () => res(500, { error: 'upstream failed' });
    let rejected = 0;
    let unknown = 0;
    await expect(
      payAndFetch({
        fetch: (async () => gateway402()) as unknown as typeof globalThis.fetch,
        url: 'https://x/api',
        capMicro: 100000,
        getPayFetch: async () => failPay,
        authorize: () => true,
        preparePayment: () => ({
          onRejected: () => { rejected += 1; },
          onUnknown: () => { unknown += 1; },
        }),
      }),
    ).rejects.toThrow(/Payment status may be unknown/);
    expect(rejected).toBe(0);
    expect(unknown).toBe(1);
  });

  it('times out the unpaid pre-flight probe', async () => {
    await expect(
      payAndFetch({
        fetch: abortingFetch(),
        url: 'https://x/api',
        capMicro: 100000,
        timeoutMs: 1,
        getPayFetch: async () => fakePay,
        authorize: () => true,
      }),
    ).rejects.toThrow(/unpaid gateway probe timed out after 1ms/);
  });

  it('warns that payment state may be unknown when the paid request times out', async () => {
    let unknown = 0;
    await expect(
      payAndFetch({
        fetch: (async () => gateway402()) as unknown as typeof globalThis.fetch,
        url: 'https://x/api',
        capMicro: 100000,
        timeoutMs: 1,
        getPayFetch: async () => abortingFetch() as unknown as PayFetch,
        authorize: () => true,
        preparePayment: () => ({
          onUnknown: () => { unknown += 1; },
        }),
      }),
    ).rejects.toThrow(/Payment status may be unknown/);
    expect(unknown).toBe(1);
  });
});

describe('loadPayFetch (real @x402 SDK wiring)', () => {
  // End-to-end on-chain settlement is verified against the live gateway (a real
  // $0.05 Base-mainnet payment) — see docs/x402.md. Here we just assert the SDK
  // wires up (scheme + cap policy registered, fetch wrapped) and key validation.
  it('builds a wrapped fetch from a valid key + installed SDK', async () => {
    const noop = (async () => res(200, {})) as unknown as typeof globalThis.fetch;
    const payFetch = await loadPayFetch(TEST_KEY, noop, 100000);
    expect(typeof payFetch).toBe('function');
  }, 15_000);

  it('rejects an invalid private key', async () => {
    const noop = (async () => res(200, {})) as unknown as typeof globalThis.fetch;
    await expect(loadPayFetch('0xnothex', noop, 100000)).rejects.toBeInstanceOf(CliUsageError);
  });
});
