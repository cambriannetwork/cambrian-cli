/**
 * Integration tests for `cambrian pay <group> <resource>` via runCli with an
 * injected fetch + throwaway key. Covers help, group/resource validation,
 * missing key, the unpaid cost preview, and the spend cap. Actual on-chain
 * settlement is verified live (a real $0.05 Base payment — see docs/x402.md) and
 * by the payAndFetch flow unit test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runCli } from '../src/cli/index.js';
import type { Runtime } from '../src/cli/core.js';
import { readConfig } from '../src/cli/config.js';
import { prepareX402PaymentAttempt } from '../src/cli/x402-handlers.js';
import type { PaymentRequirement } from '../src/x402/payment.js';

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
};

const created: string[] = [];
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cambrian-pay-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function gw402(): typeof globalThis.fetch {
  return (async (url: string) => {
    // record the URL the CLI built for assertions via a side channel
    (gw402 as unknown as { lastUrl?: string }).lastUrl = url;
    return new Response(JSON.stringify(REQUIRED_BODY), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
}

function run(
  argv: string[],
  overrides: Partial<Runtime> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const env = { CAMBRIAN_SCHEMA_MODE: 'bundled', ...(overrides.env ?? {}) };
  return runCli(argv, {
    stdout: (l) => { stdout += l + '\n'; },
    stderr: (l) => { stderr += l + '\n'; },
    ...overrides,
    env,
  }).then((code) => ({ code, stdout, stderr }));
}

function runtimeWithHome(home: string): Runtime {
  return {
    stdout: () => {},
    stdoutRaw: () => {},
    stderr: () => {},
    fetch: gw402(),
    env: {},
    homedir: () => home,
    isTTY: false,
  };
}

describe('cambrian pay', () => {
  it('prints help with no group', async () => {
    const { code, stdout } = await run(['pay']);
    expect(code).toBe(0);
    expect(stdout).toContain('Pay-per-call via x402');
    expect(stdout).toContain('solana | base (evm) | deep42 | risk');
    expect(stdout).toContain('--timeout <ms>');
    expect(stdout).toContain('npm install -g @x402/core @x402/fetch @x402/evm viem');
  });

  it('errors (exit 2) on an unknown group with a suggestion', async () => {
    const { code, stderr } = await run(['pay', 'solanaa', 'tokens']);
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown pay group');
  });

  it('errors (exit 2) on an unknown resource', async () => {
    const { code, stderr } = await run(['pay', 'deep42', 'not-a-resource'], {
      env: { CAMBRIAN_X402_PRIVATE_KEY: TEST_KEY },
    });
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown deep42 resource');
  });

  it('errors (exit 2) when no wallet key is set', async () => {
    const { code, stderr } = await run(['pay', 'deep42', 'social-data/alpha-tweet-detection', '--limit', '1']);
    expect(code).toBe(2);
    expect(stderr).toContain('CAMBRIAN_X402_PRIVATE_KEY');
  });

  it('rejects a bare --timeout before network access', async () => {
    let fetched = false;
    const fetch = (async () => {
      fetched = true;
      return gw402();
    }) as unknown as typeof globalThis.fetch;
    const { code, stderr } = await run(
      ['pay', 'deep42', 'social-data/alpha-tweet-detection', '--timeout'],
      { env: { CAMBRIAN_X402_PRIVATE_KEY: TEST_KEY }, fetch },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('--timeout requires a value');
    expect(fetched).toBe(false);
  });

  it('rejects missing required resource params before the x402 probe', async () => {
    let fetched = false;
    const fetch = (async () => {
      fetched = true;
      return gw402();
    }) as unknown as typeof globalThis.fetch;
    const { code, stderr } = await run(
      ['pay', 'solana', 'holder-token-balances', '--yes'],
      { env: { CAMBRIAN_X402_PRIVATE_KEY: TEST_KEY }, fetch },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('Missing required option --wallet-address');
    expect(fetched).toBe(false);
  });

  it('rejects invalid typed params before the x402 probe', async () => {
    let fetched = false;
    const fetch = (async () => {
      fetched = true;
      return gw402();
    }) as unknown as typeof globalThis.fetch;
    const { code, stderr } = await run(
      ['pay', 'deep42', 'social-data/alpha-tweet-detection', '--limit', 'nope', '--yes'],
      { env: { CAMBRIAN_X402_PRIVATE_KEY: TEST_KEY }, fetch },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('--limit must be an integer');
    expect(fetched).toBe(false);
  });

  it('previews and aborts without --yes, building the /api/v1/<group>/<resource> URL', async () => {
    const fetch = gw402();
    const { code, stderr } = await run(
      ['pay', 'deep42', 'social-data/alpha-tweet-detection', '--limit', '1'],
      { env: { CAMBRIAN_X402_PRIVATE_KEY: TEST_KEY }, fetch },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('$0.05');
    expect(stderr).toContain('re-run with --yes');
    expect((gw402 as unknown as { lastUrl?: string }).lastUrl).toBe(
      'https://x402.cambrian.network/api/v1/deep42/social-data/alpha-tweet-detection?limit=1',
    );
  });

  it('routes base/evm and risk to the right paths in the preview', async () => {
    const fetch = gw402();
    await run(['pay', 'base', 'price-current', '--token-address', '0xabc'], {
      env: { CAMBRIAN_X402_PRIVATE_KEY: TEST_KEY }, fetch,
    });
    expect((gw402 as unknown as { lastUrl?: string }).lastUrl).toContain('/api/v1/evm/price-current');

    await run(['pay', 'risk', 'perp-risk-engine'], {
      env: { CAMBRIAN_X402_PRIVATE_KEY: TEST_KEY }, fetch,
    });
    expect((gw402 as unknown as { lastUrl?: string }).lastUrl).toContain(
      'https://x402.cambrian.network/api/v1/perp-risk-engine?',
    );
    expect((gw402 as unknown as { lastUrl?: string }).lastUrl).toContain('risk_horizon=1d');
  });

  it('rejects when price exceeds --max-amount (exit 2)', async () => {
    const { code, stderr } = await run(
      ['pay', 'deep42', 'social-data/alpha-tweet-detection', '--max-amount', '0.01', '--yes'],
      { env: { CAMBRIAN_X402_PRIVATE_KEY: TEST_KEY }, fetch: gw402() },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('exceeds your --max-amount');
  });

  it('blocks identical paid retries while the previous attempt is still pending', () => {
    const home = tempHome();
    const runtime = runtimeWithHome(home);
    const req = REQUIRED_BODY.accepts[0] as PaymentRequirement;
    const url = 'https://x402.cambrian.network/api/v1/deep42/social-data/alpha-tweet-detection?limit=1';

    const attempt = prepareX402PaymentAttempt(runtime, TEST_KEY, url, req, 1_000);

    expect(attempt.headers['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(attempt.headers['X-Cambrian-Idempotency-Key']).toBe(attempt.headers['Idempotency-Key']);
    expect(Object.keys(readConfig(runtime).x402PendingPayments ?? {})).toHaveLength(1);

    expect(() => prepareX402PaymentAttempt(runtime, TEST_KEY, url, req, 2_000)).toThrow(
      /previous paid attempt/,
    );

    attempt.onSuccess();
    expect(readConfig(runtime).x402PendingPayments).toBeUndefined();
    expect(() => prepareX402PaymentAttempt(runtime, TEST_KEY, url, req, 3_000)).not.toThrow();
  });

  it('keeps the pending guard on unknown payment state and prunes it after expiry', () => {
    const home = tempHome();
    const runtime = runtimeWithHome(home);
    const req = { ...(REQUIRED_BODY.accepts[0] as PaymentRequirement), maxTimeoutSeconds: 0 };
    const url = 'https://x402.cambrian.network/api/v1/deep42/social-data/alpha-tweet-detection?limit=1';

    const attempt = prepareX402PaymentAttempt(runtime, TEST_KEY, url, req, 1_000);
    attempt.onUnknown();

    expect(() => prepareX402PaymentAttempt(runtime, TEST_KEY, url, req, 2_000)).toThrow(
      /previous paid attempt/,
    );
    expect(() => prepareX402PaymentAttempt(runtime, TEST_KEY, url, req, 62_000)).not.toThrow();
  });
});
