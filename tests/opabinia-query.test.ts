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

  it('does not send phantom pagination to token holder history', async () => {
    const { client, urls } = recordingClient();

    await client.getSolanaTokenHoldersOverTime({
      token_address: 'So11111111111111111111111111111111111111112',
      start_block: 100,
      end_block: 200,
      interval: 10,
      limit: 5,
      offset: 10,
    });

    expect(urls[0]).toBe(
      'https://api.cambrian.org/solana/tokens/holders-over-time?token_address=So11111111111111111111111111111111111111112&start_block=100&end_block=200&interval=10',
    );
  });

  it('does not send phantom pagination to token holder distribution history', async () => {
    const { client, urls } = recordingClient();

    await client.getSolanaTokenHolderDistributionOverTime({
      token_address: 'So11111111111111111111111111111111111111112',
      start_block: 100,
      end_block: 200,
      interval: 10,
      limit: 5,
      offset: 10,
    });

    expect(urls[0]).toBe(
      'https://api.cambrian.org/solana/tokens/holder-distribution-over-time?token_address=So11111111111111111111111111111111111111112&start_block=100&end_block=200&interval=10',
    );
  });
});

describe('OpabiniaClient live endpoint shapes', () => {
  const sol = 'So11111111111111111111111111111111111111112';
  const cases: Array<[string, (c: OpabiniaClient) => Promise<unknown>, string]> = [
    ['price current (legacy key)', (c) => c.getSolanaPriceCurrent({ token_address: sol }), `/solana/price-current?token_addresses=${sol}`],
    ['price multi', (c) => c.getSolanaPriceMulti({ token_addresses: `${sol},x` }), `/solana/price-current?token_addresses=${sol}%2Cx`],
    ['token details (legacy key)', (c) => c.getSolanaTokenDetails({ token_address: sol }), `/solana/token-details?token_addresses=${sol}`],
    ['token details multi', (c) => c.getSolanaTokenDetailsMulti({ token_addresses: sol }), `/solana/token-details?token_addresses=${sol}`],
    ['price volume single', (c) => c.getSolanaPriceVolumeSingle({ token_address: sol, timeframe: '24h' }), `/solana/price-volume?token_addresses=${sol}&timeframe=24h`],
    ['price volume multi', (c) => c.getSolanaPriceVolumeMulti({ token_addresses: sol, timeframe: '24h' }), `/solana/price-volume?token_addresses=${sol}&timeframe=24h`],
    ['orca pool (legacy key)', (c) => c.getSolanaOrcaPool({ pool_address: 'p' }), '/solana/orca/pool?pool_addresses=p'],
    ['meteora pool multi', (c) => c.getSolanaMeteoraPoolMulti({ pool_addresses: 'p' }), '/solana/meteora-dlmm/pool?pool_addresses=p'],
    ['raydium pool', (c) => c.getSolanaRaydiumPool({ pool_addresses: 'p' }), '/solana/raydium-clmm/pool?pool_addresses=p'],
    ['evm price hour (legacy hours)', (c) => c.getEvmPriceHour({ token_address: '0xa', hours: 2 }), '/evm/price-hour?limit=2&token_address=0xa'],
    ['evm tvl status drops whitelisted', (c) => c.getEvmTvlStatus({ wallet_address: '0xa', whitelisted: true, hasprice: true }), '/evm/tvl/status?wallet_address=0xa&hasprice=true'],
    ['evm pools comma-joins sort arrays', (c) => c.getEvmUniswapV3Pools({ order_desc: ['tvl_usd', 'fee_tier'] }), '/evm/uniswap/v3/pools?order_desc=tvl_usd%2Cfee_tier'],
  ];

  it.each(cases)('%s', async (_name, call, expected) => {
    const { client, urls } = recordingClient();
    await call(client);
    expect(urls[0]).toBe(`https://api.cambrian.org${expected}`);
  });
});
