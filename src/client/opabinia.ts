import { BaseClient } from './base-client.js';
import type {
  BaseClientOptions,
  TableResponse,
  PaginationParams,
  SolanaTokensParams,
  SolanaPoolAddressParams,
  SolanaTokenAddressParams,
  SolanaMultiTokenAddressParams,
  SolanaOhlcvParams,
  SolanaOhlcvBaseQuoteParams,
  SolanaOhlcvPoolParams,
  SolanaPriceHourParams,
  SolanaPriceUnixParams,
  SolanaPriceVolumeParams,
  SolanaPriceVolumeMultiParams,
  SolanaHolderTokenBalancesParams,
  SolanaPoolTransactionsParams,
  SolanaPoolTransactionsTimeBoundedParams,
  SolanaTokenTransactionsParams,
  SolanaTokenTransactionsTimeBoundedParams,
  SolanaTokenMintBurnParams,
  SolanaTokenPoolSearchParams,
  SolanaTradeStatisticsParams,
  SolanaTraderLeaderboardParams,
  SolanaTrendingTokensParams,
  SolanaWalletBalanceHistoryParams,
  SolanaTokenHoldersParams,
  SolanaTokenHoldersOverTimeParams,
  SolanaTokenHolderDistributionOverTimeParams,
  SolanaMeteoraPoolParams,
  SolanaMeteoraPoolMultiParams,
  SolanaMeteoraPoolsParams,
  SolanaRaydiumPoolParams,
  SolanaRaydiumPoolMultiParams,
  SolanaRaydiumPoolsParams,
  SolanaOrcaPoolParams,
  SolanaOrcaPoolMultiParams,
  SolanaOrcaFeeMetricsParams,
  SolanaOrcaFeeRangesRequestParams,
  SolanaOrcaHistoricalDataParams,
  SolanaOrcaLiquidityMapParams,
  EvmPriceCurrentParams,
  EvmPriceHourParams,
  EvmTvlStatusParams,
  EvmTvlTopOwnersParams,
  EvmPoolsParams,
  EvmPoolParams,
  EvmAeroV2PoolParams,
  EvmAeroV2PoolVolumeParams,
  EvmAeroV2FeeMetricsParams,
  EvmAeroV2ProvidersParams,
  EvmAeroV2ProviderPositionsParams,
  EvmAeroV2ProviderSummaryParams,
  EvmAeroV2PoolsParams,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.cambrian.org';

// Legacy singular keys (token_address, pool_address) still work; the live endpoints take only the plural form.
function pluralize(opts: object, key: string): Record<string, unknown> {
  const { [key]: one, ...rest } = opts as Record<string, unknown>;
  return one === undefined ? rest : { [`${key}es`]: one, ...rest };
}

export class OpabiniaClient extends BaseClient {
  private withQuery(path: string, opts: object): string {
    const query = this.buildParams(opts);
    return query ? `${path}?${query}` : path;
  }

  constructor(opts: BaseClientOptions) {
    super({ ...opts, defaultBaseUrl: DEFAULT_BASE_URL });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  GENERIC QUERY (used by dynamic CLI handlers)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Generic query: call any Opabinia API path with arbitrary params.
   * apiPath may include the internal /api/v1 prefix stored in openapi-params.json.
   */
  async query(apiPath: string, params: Record<string, unknown> = {}): Promise<unknown> {
    // The public gateway does not expose the upstream /api/v1 prefix.
    const path = apiPath.replace(/^\/api\/v1/, '');
    const q = this.buildParams(params);
    return this.request(q ? `${path}?${q}` : path);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SOLANA  (44 endpoints)
  // ═══════════════════════════════════════════════════════════════════

  // ── Token data ──────────────────────────────────────────────────
  async getSolanaTokens(opts: SolanaTokensParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/solana/tokens', opts));
  }

  async getSolanaTokenDetails(opts: SolanaMultiTokenAddressParams | SolanaTokenAddressParams): Promise<TableResponse> {
    return this.request(this.withQuery('/solana/token-details', pluralize(opts, 'token_address')));
  }

  /** @deprecated Use getSolanaTokenDetails({ token_addresses }); /solana/token-details-multi was removed. */
  async getSolanaTokenDetailsMulti(opts: SolanaMultiTokenAddressParams): Promise<TableResponse> {
    return this.getSolanaTokenDetails(opts);
  }

  async getSolanaTokenSecurity(opts: SolanaTokenAddressParams): Promise<TableResponse> {
    return this.request(`/solana/tokens/security?${this.buildParams(opts)}`);
  }

  // ── Token holders ───────────────────────────────────────────────
  async getSolanaTokenHolders(opts: SolanaTokenHoldersParams): Promise<TableResponse> {
    return this.request(`/solana/tokens/holders?${this.buildParams(opts)}`);
  }

  async getSolanaTokenHoldersOverTime(opts: SolanaTokenHoldersOverTimeParams): Promise<TableResponse> {
    const { token_address, start_block, end_block, interval } = opts;
    return this.request(
      `/solana/tokens/holders-over-time?${this.buildParams({ token_address, start_block, end_block, interval })}`,
    );
  }

  async getSolanaTokenHolderDistributionOverTime(opts: SolanaTokenHolderDistributionOverTimeParams): Promise<TableResponse> {
    const { token_address, start_block, end_block, interval } = opts;
    return this.request(
      `/solana/tokens/holder-distribution-over-time?${this.buildParams({ token_address, start_block, end_block, interval })}`,
    );
  }

  // ── Pricing ─────────────────────────────────────────────────────
  async getSolanaPriceCurrent(opts: SolanaMultiTokenAddressParams | SolanaTokenAddressParams): Promise<TableResponse> {
    return this.request(this.withQuery('/solana/price-current', pluralize(opts, 'token_address')));
  }

  async getSolanaPriceHour(opts: SolanaPriceHourParams): Promise<TableResponse> {
    return this.request(`/solana/price-hour?${this.buildParams(opts)}`);
  }

  /** @deprecated Use getSolanaPriceCurrent({ token_addresses }); /solana/price-multi was removed. */
  async getSolanaPriceMulti(opts: SolanaMultiTokenAddressParams): Promise<TableResponse> {
    return this.getSolanaPriceCurrent(opts);
  }

  async getSolanaPriceUnix(opts: SolanaPriceUnixParams): Promise<TableResponse> {
    return this.request(`/solana/price-unix?${this.buildParams(opts)}`);
  }

  // ── Price-volume ────────────────────────────────────────────────
  async getSolanaPriceVolume(opts: SolanaPriceVolumeMultiParams | SolanaPriceVolumeParams): Promise<TableResponse> {
    return this.request(this.withQuery('/solana/price-volume', pluralize(opts, 'token_address')));
  }

  /** @deprecated Use getSolanaPriceVolume(); /solana/price-volume/single was removed. */
  async getSolanaPriceVolumeSingle(opts: SolanaPriceVolumeParams): Promise<TableResponse> {
    return this.getSolanaPriceVolume(opts);
  }

  /** @deprecated Use getSolanaPriceVolume(); /solana/price-volume/multi was removed. */
  async getSolanaPriceVolumeMulti(opts: SolanaPriceVolumeMultiParams): Promise<TableResponse> {
    return this.getSolanaPriceVolume(opts);
  }

  // ── OHLCV ───────────────────────────────────────────────────────
  async getSolanaOhlcvToken(opts: SolanaOhlcvParams): Promise<TableResponse> {
    return this.request(`/solana/ohlcv/token?${this.buildParams(opts)}`);
  }

  async getSolanaOhlcvBaseQuote(opts: SolanaOhlcvBaseQuoteParams): Promise<TableResponse> {
    return this.request(`/solana/ohlcv/base-quote?${this.buildParams(opts)}`);
  }

  async getSolanaOhlcvPool(opts: SolanaOhlcvPoolParams): Promise<TableResponse> {
    return this.request(`/solana/ohlcv/pool?${this.buildParams(opts)}`);
  }

  // ── Wallet / holder balances ────────────────────────────────────
  async getSolanaHolderTokenBalances(opts: SolanaHolderTokenBalancesParams): Promise<TableResponse> {
    return this.request(`/solana/holder-token-balances?${this.buildParams(opts)}`);
  }

  async getSolanaWalletBalanceHistory(opts: SolanaWalletBalanceHistoryParams): Promise<TableResponse> {
    return this.request(`/solana/wallet-balance-history?${this.buildParams(opts)}`);
  }

  // ── Transactions ────────────────────────────────────────────────
  async getSolanaPoolTransactions(opts: SolanaPoolTransactionsParams): Promise<TableResponse> {
    return this.request(`/solana/pool-transactions?${this.buildParams(opts)}`);
  }

  async getSolanaPoolTransactionsTimeBounded(opts: SolanaPoolTransactionsTimeBoundedParams): Promise<TableResponse> {
    return this.request(`/solana/pool-transactions-time-bounded?${this.buildParams(opts)}`);
  }

  async getSolanaTokenTransactions(opts: SolanaTokenTransactionsParams): Promise<TableResponse> {
    return this.request(`/solana/token-transactions?${this.buildParams(opts)}`);
  }

  async getSolanaTokenTransactionsTimeBounded(opts: SolanaTokenTransactionsTimeBoundedParams): Promise<TableResponse> {
    return this.request(`/solana/token-transactions-time-bounded?${this.buildParams(opts)}`);
  }

  async getSolanaTokenMintBurnTransactions(opts: SolanaTokenMintBurnParams): Promise<TableResponse> {
    return this.request(`/solana/token-mint-burn-transactions?${this.buildParams(opts)}`);
  }

  // ── Token pool search ───────────────────────────────────────────
  async getSolanaTokenPoolSearch(opts: SolanaTokenPoolSearchParams): Promise<TableResponse> {
    return this.request(`/solana/token-pool-search?${this.buildParams(opts)}`);
  }

  // ── Trade stats & leaderboard ───────────────────────────────────
  async getSolanaTradeStatistics(opts: SolanaTradeStatisticsParams): Promise<TableResponse> {
    return this.request(`/solana/trade-statistics?${this.buildParams(opts)}`);
  }

  async getSolanaTraderLeaderboard(opts: SolanaTraderLeaderboardParams): Promise<TableResponse> {
    return this.request(`/solana/traders/leaderboard?${this.buildParams(opts)}`);
  }

  // ── Trending & block ────────────────────────────────────────────
  async getSolanaTrendingTokens(opts: SolanaTrendingTokensParams): Promise<TableResponse> {
    return this.request(this.withQuery('/solana/trending-tokens', opts));
  }

  async getSolanaLatestBlock(): Promise<TableResponse> {
    return this.request('/solana/latest-block');
  }

  // ── Meteora DLMM ───────────────────────────────────────────────
  async getSolanaMeteoraPool(opts: SolanaMeteoraPoolMultiParams | SolanaMeteoraPoolParams): Promise<TableResponse> {
    return this.request(this.withQuery('/solana/meteora-dlmm/pool', pluralize(opts, 'pool_address')));
  }

  /** @deprecated Use getSolanaMeteoraPool({ pool_addresses }); /solana/meteora-dlmm/pool-multi was removed. */
  async getSolanaMeteoraPoolMulti(opts: SolanaMeteoraPoolMultiParams): Promise<TableResponse> {
    return this.getSolanaMeteoraPool(opts);
  }

  async getSolanaMeteoraPools(opts: SolanaMeteoraPoolsParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/solana/meteora-dlmm/pools', opts));
  }

  // ── Raydium CLMM ───────────────────────────────────────────────
  async getSolanaRaydiumPool(opts: SolanaRaydiumPoolMultiParams | SolanaRaydiumPoolParams): Promise<TableResponse> {
    return this.request(this.withQuery('/solana/raydium-clmm/pool', pluralize(opts, 'pool_address')));
  }

  /** @deprecated Use getSolanaRaydiumPool({ pool_addresses }); /solana/raydium-clmm/pool-multi was removed. */
  async getSolanaRaydiumPoolMulti(opts: SolanaRaydiumPoolMultiParams): Promise<TableResponse> {
    return this.getSolanaRaydiumPool(opts);
  }

  async getSolanaRaydiumPools(opts: SolanaRaydiumPoolsParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/solana/raydium-clmm/pools', opts));
  }

  // ── Orca ────────────────────────────────────────────────────────
  async getSolanaOrcaPools(): Promise<TableResponse> {
    return this.request('/solana/orca/pools?dex=orca');
  }

  async getSolanaOrcaPool(opts: SolanaOrcaPoolMultiParams | SolanaOrcaPoolParams): Promise<TableResponse> {
    return this.request(this.withQuery('/solana/orca/pool', pluralize(opts, 'pool_address')));
  }

  /** @deprecated Use getSolanaOrcaPool({ pool_addresses }); /solana/orca/pool-multi was removed. */
  async getSolanaOrcaPoolMulti(opts: SolanaOrcaPoolMultiParams): Promise<TableResponse> {
    return this.getSolanaOrcaPool(opts);
  }

  async getSolanaOrcaFeeMetrics(opts: SolanaOrcaFeeMetricsParams): Promise<TableResponse> {
    return this.request(`/solana/orca/pools/fee-metrics?${this.buildParams(opts)}`);
  }

  async getSolanaOrcaFeeRanges(opts: SolanaOrcaFeeRangesRequestParams): Promise<TableResponse> {
    return this.request(`/solana/orca/pools/fee-ranges?${this.buildParams(opts)}`);
  }

  async getSolanaOrcaHistoricalData(opts: SolanaOrcaHistoricalDataParams): Promise<TableResponse> {
    return this.request(`/solana/orca/pools/historical-data?${this.buildParams(opts)}`);
  }

  async getSolanaOrcaLiquidityMap(opts: SolanaOrcaLiquidityMapParams): Promise<TableResponse> {
    return this.request(`/solana/orca/pools/liquidity-map?${this.buildParams(opts)}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  EVM  (29 endpoints)
  // ═══════════════════════════════════════════════════════════════════

  // ── Common ──────────────────────────────────────────────────────
  async getEvmChains(): Promise<TableResponse> {
    return this.request('/evm/chains');
  }

  async getEvmDexes(): Promise<TableResponse> {
    return this.request('/evm/dexes');
  }

  async getEvmTokens(): Promise<TableResponse> {
    return this.request('/evm/tokens');
  }

  async getEvmPriceCurrent(opts: EvmPriceCurrentParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/evm/price-current', opts));
  }

  async getEvmPriceHour(opts: EvmPriceHourParams): Promise<TableResponse> {
    // The API has no `hours` param; it returns one row per hour, so `limit` sets the count.
    const { hours, ...rest } = opts;
    return this.request(this.withQuery('/evm/price-hour', { limit: hours, ...rest }));
  }

  // ── TVL ─────────────────────────────────────────────────────────
  async getEvmTvlStatus(opts: EvmTvlStatusParams): Promise<TableResponse> {
    // The API returns 400 for the unknown `whitelisted` param, so it is not sent.
    const { whitelisted: _whitelisted, ...rest } = opts;
    return this.request(this.withQuery('/evm/tvl/status', rest));
  }

  async getEvmTvlTopOwners(opts: EvmTvlTopOwnersParams): Promise<TableResponse> {
    return this.request(`/evm/tvl/top-owners?${this.buildParams(opts)}`);
  }

  // ── Aerodrome V2 ───────────────────────────────────────────────
  async getEvmAeroV2Pools(opts: EvmAeroV2PoolsParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/evm/aero/v2/pools', opts));
  }

  async getEvmAeroV2Pool(opts: EvmAeroV2PoolParams): Promise<TableResponse> {
    return this.request(`/evm/aero/v2/pool?${this.buildParams(opts)}`);
  }

  async getEvmAeroV2PoolVolume(opts: EvmAeroV2PoolVolumeParams): Promise<TableResponse> {
    return this.request(`/evm/aero/v2/pool-volume?${this.buildParams(opts)}`);
  }

  async getEvmAeroV2FeeMetrics(opts: EvmAeroV2FeeMetricsParams): Promise<TableResponse> {
    return this.request(`/evm/aero/v2/fee-metrics?${this.buildParams(opts)}`);
  }

  /** @deprecated The API removed this endpoint (HTTP 404). This method will be removed in 2.0. */
  async getEvmAeroV2Providers(opts: EvmAeroV2ProvidersParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/evm/aero/v2/providers', opts));
  }

  /** @deprecated The API removed this endpoint (HTTP 404). This method will be removed in 2.0. */
  async getEvmAeroV2ProviderPositions(opts: EvmAeroV2ProviderPositionsParams): Promise<TableResponse> {
    return this.request(`/evm/aero/v2/provider-positions?${this.buildParams(opts)}`);
  }

  async getEvmAeroV2ProviderSummary(opts: EvmAeroV2ProviderSummaryParams): Promise<TableResponse> {
    return this.request(`/evm/aero/v2/provider-summary?${this.buildParams(opts)}`);
  }

  // ── Aerodrome V3 ───────────────────────────────────────────────
  /** @deprecated The API removed this endpoint (HTTP 404). This method will be removed in 2.0. */
  async getEvmAeroV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/evm/aero/v3/pools', opts));
  }

  async getEvmAeroV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/aero/v3/pool?${this.buildParams(opts)}`);
  }

  // ── Uniswap V3 ─────────────────────────────────────────────────
  async getEvmUniswapV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/evm/uniswap/v3/pools', opts));
  }

  async getEvmUniswapV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/uniswap/v3/pool?${this.buildParams(opts)}`);
  }

  // ── Sushi V3 ────────────────────────────────────────────────────
  async getEvmSushiV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/evm/sushi/v3/pools', opts));
  }

  async getEvmSushiV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/sushi/v3/pool?${this.buildParams(opts)}`);
  }

  // ── Pancake V3 ──────────────────────────────────────────────────
  async getEvmPancakeV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/evm/pancake/v3/pools', opts));
  }

  async getEvmPancakeV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/pancake/v3/pool?${this.buildParams(opts)}`);
  }

  // ── Clones V3 ───────────────────────────────────────────────────
  /** @deprecated The API removed this endpoint (HTTP 404). This method will be removed in 2.0. */
  async getEvmClonesV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/evm/clones/v3/pools', opts));
  }

  /** @deprecated The API removed this endpoint (HTTP 404). This method will be removed in 2.0. */
  async getEvmClonesV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/clones/v3/pool?${this.buildParams(opts)}`);
  }

  // ── Alien V3 ────────────────────────────────────────────────────
  async getEvmAlienV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(this.withQuery('/evm/alien/v3/pools', opts));
  }

  async getEvmAlienV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/alien/v3/pool?${this.buildParams(opts)}`);
  }
}
