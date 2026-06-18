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
  SolanaOrcaFeeRangesParams,
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

const DEFAULT_BASE_URL = 'https://opabinia.cambrian.network/api/v1';

export class OpabiniaClient extends BaseClient {
  constructor(opts: BaseClientOptions) {
    super({ ...opts, defaultBaseUrl: DEFAULT_BASE_URL });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  GENERIC QUERY (used by dynamic CLI handlers)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Generic query: call any Opabinia API path with arbitrary params.
   * apiPath should include the /api/v1 prefix (as stored in openapi-params.json).
   */
  async query(apiPath: string, params: Record<string, unknown> = {}): Promise<unknown> {
    // Strip /api/v1 prefix since baseUrl already includes it
    const path = apiPath.replace(/^\/api\/v1/, '');
    const q = this.buildParams(params);
    return this.request(q ? `${path}?${q}` : path);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SOLANA  (44 endpoints)
  // ═══════════════════════════════════════════════════════════════════

  // ── Token data ──────────────────────────────────────────────────
  async getSolanaTokens(opts: SolanaTokensParams = {}): Promise<TableResponse> {
    return this.request(`/solana/tokens?${this.buildParams(opts)}`);
  }

  async getSolanaTokenDetails(opts: SolanaTokenAddressParams): Promise<TableResponse> {
    return this.request(`/solana/token-details?${this.buildParams(opts)}`);
  }

  async getSolanaTokenDetailsMulti(opts: SolanaMultiTokenAddressParams): Promise<TableResponse> {
    return this.request(`/solana/token-details-multi?${this.buildParams(opts)}`);
  }

  async getSolanaTokenSecurity(opts: SolanaTokenAddressParams): Promise<TableResponse> {
    return this.request(`/solana/tokens/security?${this.buildParams(opts)}`);
  }

  // ── Token holders ───────────────────────────────────────────────
  async getSolanaTokenHolders(opts: SolanaTokenHoldersParams): Promise<TableResponse> {
    return this.request(`/solana/tokens/holders?${this.buildParams(opts)}`);
  }

  async getSolanaTokenHoldersOverTime(opts: SolanaTokenHoldersOverTimeParams): Promise<TableResponse> {
    return this.request(`/solana/tokens/holders-over-time?${this.buildParams(opts)}`);
  }

  async getSolanaTokenHolderDistributionOverTime(opts: SolanaTokenHolderDistributionOverTimeParams): Promise<TableResponse> {
    return this.request(`/solana/tokens/holder-distribution-over-time?${this.buildParams(opts)}`);
  }

  // ── Pricing ─────────────────────────────────────────────────────
  async getSolanaPriceCurrent(opts: SolanaTokenAddressParams): Promise<TableResponse> {
    return this.request(`/solana/price-current?${this.buildParams(opts)}`);
  }

  async getSolanaPriceHour(opts: SolanaPriceHourParams): Promise<TableResponse> {
    return this.request(`/solana/price-hour?${this.buildParams(opts)}`);
  }

  async getSolanaPriceMulti(opts: SolanaMultiTokenAddressParams): Promise<TableResponse> {
    return this.request(`/solana/price-multi?${this.buildParams(opts)}`);
  }

  async getSolanaPriceUnix(opts: SolanaPriceUnixParams): Promise<TableResponse> {
    return this.request(`/solana/price-unix?${this.buildParams(opts)}`);
  }

  // ── Price-volume ────────────────────────────────────────────────
  async getSolanaPriceVolumeSingle(opts: SolanaPriceVolumeParams): Promise<TableResponse> {
    return this.request(`/solana/price-volume/single?${this.buildParams(opts)}`);
  }

  async getSolanaPriceVolumeMulti(opts: SolanaPriceVolumeMultiParams): Promise<TableResponse> {
    return this.request(`/solana/price-volume/multi?${this.buildParams(opts)}`);
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
  async getSolanaTrendingTokens(opts: SolanaTrendingTokensParams = {}): Promise<TableResponse> {
    return this.request(`/solana/trending-tokens?${this.buildParams(opts)}`);
  }

  async getSolanaLatestBlock(): Promise<TableResponse> {
    return this.request('/solana/latest-block');
  }

  // ── Meteora DLMM ───────────────────────────────────────────────
  async getSolanaMeteoraPool(opts: SolanaMeteoraPoolParams): Promise<TableResponse> {
    return this.request(`/solana/meteora-dlmm/pool?${this.buildParams(opts)}`);
  }

  async getSolanaMeteoraPoolMulti(opts: SolanaMeteoraPoolMultiParams): Promise<TableResponse> {
    return this.request(`/solana/meteora-dlmm/pool-multi?${this.buildParams(opts)}`);
  }

  async getSolanaMeteoraPools(opts: SolanaMeteoraPoolsParams = {}): Promise<TableResponse> {
    return this.request(`/solana/meteora-dlmm/pools?${this.buildParams(opts)}`);
  }

  // ── Raydium CLMM ───────────────────────────────────────────────
  async getSolanaRaydiumPool(opts: SolanaRaydiumPoolParams): Promise<TableResponse> {
    return this.request(`/solana/raydium-clmm/pool?${this.buildParams(opts)}`);
  }

  async getSolanaRaydiumPoolMulti(opts: SolanaRaydiumPoolMultiParams): Promise<TableResponse> {
    return this.request(`/solana/raydium-clmm/pool-multi?${this.buildParams(opts)}`);
  }

  async getSolanaRaydiumPools(opts: SolanaRaydiumPoolsParams = {}): Promise<TableResponse> {
    return this.request(`/solana/raydium-clmm/pools?${this.buildParams(opts)}`);
  }

  // ── Orca ────────────────────────────────────────────────────────
  async getSolanaOrcaPools(): Promise<TableResponse> {
    return this.request('/solana/orca/pools?dex=orca');
  }

  async getSolanaOrcaPool(opts: SolanaOrcaPoolParams): Promise<TableResponse> {
    return this.request(`/solana/orca/pool?${this.buildParams(opts)}`);
  }

  async getSolanaOrcaPoolMulti(opts: SolanaOrcaPoolMultiParams): Promise<TableResponse> {
    return this.request(`/solana/orca/pool-multi?${this.buildParams(opts)}`);
  }

  async getSolanaOrcaFeeMetrics(opts: SolanaOrcaFeeMetricsParams): Promise<TableResponse> {
    return this.request(`/solana/orca/pools/fee-metrics?${this.buildParams(opts)}`);
  }

  async getSolanaOrcaFeeRanges(opts: SolanaOrcaFeeRangesParams & { days: number }): Promise<TableResponse> {
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
    const q = this.buildParams(opts);
    return this.request(q ? `/evm/price-current?${q}` : '/evm/price-current');
  }

  async getEvmPriceHour(opts: EvmPriceHourParams): Promise<TableResponse> {
    return this.request(`/evm/price-hour?${this.buildParams(opts)}`);
  }

  // ── TVL ─────────────────────────────────────────────────────────
  async getEvmTvlStatus(opts: EvmTvlStatusParams): Promise<TableResponse> {
    return this.request(`/evm/tvl/status?${this.buildParams(opts)}`);
  }

  async getEvmTvlTopOwners(opts: EvmTvlTopOwnersParams): Promise<TableResponse> {
    return this.request(`/evm/tvl/top-owners?${this.buildParams(opts)}`);
  }

  // ── Aerodrome V2 ───────────────────────────────────────────────
  async getEvmAeroV2Pools(opts: EvmAeroV2PoolsParams = {}): Promise<TableResponse> {
    return this.request(`/evm/aero/v2/pools?${this.buildParams(opts)}`);
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

  async getEvmAeroV2Providers(opts: EvmAeroV2ProvidersParams = {}): Promise<TableResponse> {
    return this.request(`/evm/aero/v2/providers?${this.buildParams(opts)}`);
  }

  async getEvmAeroV2ProviderPositions(opts: EvmAeroV2ProviderPositionsParams): Promise<TableResponse> {
    return this.request(`/evm/aero/v2/provider-positions?${this.buildParams(opts)}`);
  }

  async getEvmAeroV2ProviderSummary(opts: EvmAeroV2ProviderSummaryParams): Promise<TableResponse> {
    return this.request(`/evm/aero/v2/provider-summary?${this.buildParams(opts)}`);
  }

  // ── Aerodrome V3 ───────────────────────────────────────────────
  async getEvmAeroV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(`/evm/aero/v3/pools?${this.buildParams(opts)}`);
  }

  async getEvmAeroV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/aero/v3/pool?${this.buildParams(opts)}`);
  }

  // ── Uniswap V3 ─────────────────────────────────────────────────
  async getEvmUniswapV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(`/evm/uniswap/v3/pools?${this.buildParams(opts)}`);
  }

  async getEvmUniswapV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/uniswap/v3/pool?${this.buildParams(opts)}`);
  }

  // ── Sushi V3 ────────────────────────────────────────────────────
  async getEvmSushiV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(`/evm/sushi/v3/pools?${this.buildParams(opts)}`);
  }

  async getEvmSushiV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/sushi/v3/pool?${this.buildParams(opts)}`);
  }

  // ── Pancake V3 ──────────────────────────────────────────────────
  async getEvmPancakeV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(`/evm/pancake/v3/pools?${this.buildParams(opts)}`);
  }

  async getEvmPancakeV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/pancake/v3/pool?${this.buildParams(opts)}`);
  }

  // ── Clones V3 ───────────────────────────────────────────────────
  async getEvmClonesV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(`/evm/clones/v3/pools?${this.buildParams(opts)}`);
  }

  async getEvmClonesV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/clones/v3/pool?${this.buildParams(opts)}`);
  }

  // ── Alien V3 ────────────────────────────────────────────────────
  async getEvmAlienV3Pools(opts: EvmPoolsParams = {}): Promise<TableResponse> {
    return this.request(`/evm/alien/v3/pools?${this.buildParams(opts)}`);
  }

  async getEvmAlienV3Pool(opts: EvmPoolParams): Promise<TableResponse> {
    return this.request(`/evm/alien/v3/pool?${this.buildParams(opts)}`);
  }
}
