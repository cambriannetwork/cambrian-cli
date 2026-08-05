import { describe, expect, it } from 'vitest';
import { OpabiniaClient } from '../src/client/opabinia.js';

function recordingClient() {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ columns: [], data: [], rows: 0 }));
  }) as unknown as typeof globalThis.fetch;
  return { client: new OpabiniaClient({ apiKey: 'test', fetch }), urls };
}

const optionalMethods = [
  'getSolanaTokens',
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

describe('OpabiniaClient optional query parameters', () => {
  it.each(optionalMethods)('%s omits an empty query string', async (method) => {
    const { client, urls } = recordingClient();

    await (client[method] as () => Promise<unknown>)();

    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toMatch(/\?$/);
  });

  it('preserves supplied query parameters', async () => {
    const { client, urls } = recordingClient();

    await client.getSolanaTokens({ limit: 5 });

    expect(urls[0]).toBe('https://api.cambrian.org/solana/tokens?limit=5');
  });

  it('sends the required trending-token sort field', async () => {
    const { client, urls } = recordingClient();

    await client.getSolanaTrendingTokens({ order_by: 'volume_usd_24h' });

    expect(urls[0]).toBe(
      'https://api.cambrian.org/solana/trending-tokens?order_by=volume_usd_24h',
    );
  });
});
