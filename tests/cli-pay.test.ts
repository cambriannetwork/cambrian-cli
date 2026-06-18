/**
 * Integration tests for `cambrian pay <group> <resource>` via runCli with an
 * injected fetch + throwaway key. Covers help, group/resource validation,
 * missing key, the unpaid cost preview, and the spend cap. Actual on-chain
 * settlement is verified live (a real $0.05 Base payment — see docs/x402.md) and
 * by the payAndFetch flow unit test.
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../src/cli/index.js';
import type { Runtime } from '../src/cli/core.js';

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
  return runCli(argv, {
    stdout: (l) => { stdout += l + '\n'; },
    stderr: (l) => { stderr += l + '\n'; },
    env: {},
    ...overrides,
  }).then((code) => ({ code, stdout, stderr }));
}

describe('cambrian pay', () => {
  it('prints help with no group', async () => {
    const { code, stdout } = await run(['pay']);
    expect(code).toBe(0);
    expect(stdout).toContain('Pay-per-call via x402');
    expect(stdout).toContain('solana | base (evm) | deep42 | risk');
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
    expect((gw402 as unknown as { lastUrl?: string }).lastUrl).toBe(
      'https://x402.cambrian.network/api/v1/perp-risk-engine',
    );
  });

  it('rejects when price exceeds --max-amount (exit 2)', async () => {
    const { code, stderr } = await run(
      ['pay', 'deep42', 'social-data/alpha-tweet-detection', '--max-amount', '0.01', '--yes'],
      { env: { CAMBRIAN_X402_PRIVATE_KEY: TEST_KEY }, fetch: gw402() },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('exceeds your --max-amount');
  });
});
