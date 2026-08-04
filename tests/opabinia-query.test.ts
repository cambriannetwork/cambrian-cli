/**
 * URL construction tests for OpabiniaClient.
 *
 * Methods whose options are all optional interpolated buildParams() directly
 * into the template, so a no-argument call produced a URL ending in a bare
 * `?`. getEvmPriceCurrent already guarded against this; the rest did not.
 */

import { describe, it, expect } from 'vitest';
import { OpabiniaClient } from '../src/client/opabinia.js';

function recordingClient() {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ columns: [], data: [], rows: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { client: new OpabiniaClient({ apiKey: 'k', fetch }), urls };
}

/** Every method that takes a fully optional options object. */
const optionalArgMethods = [
  'getSolanaTokens',
  'getSolanaTrendingTokens',
  'getSolanaMeteoraPools',
  'getSolanaRaydiumPools',
  'getEvmPriceCurrent',
  'getEvmAeroV2Pools',
  'getEvmAeroV2Providers',
  'getEvmAeroV3Pools',
  'getEvmUniswapV3Pools',
  'getEvmSushiV3Pools',
  'getEvmPancakeV3Pools',
  'getEvmClonesV3Pools',
  'getEvmAlienV3Pools',
] as const;

describe('OpabiniaClient query string construction', () => {
  it.each(optionalArgMethods)('%s omits the ? when called with no options', async (method) => {
    const { client, urls } = recordingClient();

    await (client as unknown as Record<string, () => Promise<unknown>>)[method]();

    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toMatch(/\?$/);
  });

  it.each(optionalArgMethods)('%s omits the ? when called with an empty object', async (method) => {
    const { client, urls } = recordingClient();

    await (client as unknown as Record<string, (o: object) => Promise<unknown>>)[method]({});

    expect(urls[0]).not.toMatch(/\?$/);
  });

  it('still appends the query string when options are provided', async () => {
    const { client, urls } = recordingClient();

    await client.getSolanaTokens({ limit: 5 });

    expect(urls[0]).toContain('/solana/tokens?');
    expect(urls[0]).toContain('limit=5');
  });

  it('leaves methods with required parameters unchanged', async () => {
    const { client, urls } = recordingClient();

    await client.getSolanaTokenDetails({ token_address: 'So11111111111111111111111111111111111111112' });

    expect(urls[0]).toContain('/solana/token-details?token_address=');
  });
});
