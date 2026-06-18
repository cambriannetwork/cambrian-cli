// ── Shared client options ──────────────────────────────────────────────
export interface CambrianClientOptions {
  apiKey: string;
  opabiniaBaseUrl?: string;
  deep42BaseUrl?: string;
  riskBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in milliseconds. Defaults to 90000. */
  timeoutMs?: number;
  /**
   * Number of automatic retries on transient failures (408/429/5xx and network
   * errors), using exponential backoff with full jitter that honors any
   * `Retry-After` header. Defaults to 0 (no retries). All API calls are GET, so
   * retries are idempotent.
   */
  maxRetries?: number;
}

export interface BaseClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in milliseconds. Defaults to 90000. */
  timeoutMs?: number;
  /** Automatic retries on transient failures. Defaults to 0. See CambrianClientOptions. */
  maxRetries?: number;
}

// ── Rate limit ────────────────────────────────────────────────────────
export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  retryAfterSeconds: number | null;
}

// ── API error options ─────────────────────────────────────────────────
export interface ApiErrorOptions {
  status: number;
  code: string | null;
  message: string;
  body: string;
  rateLimit: RateLimitInfo | null;
  /** Whether retrying the request may succeed (true for 408/429/5xx). */
  retryable?: boolean;
  /** Raw response body, for debugging only. Never surfaced to users. */
  rawBody?: string;
}

// ── Opabinia TableResponse ────────────────────────────────────────────
export interface TableColumn {
  name: string;
  type: string;
}

export interface TableResponse {
  columns: TableColumn[];
  data: unknown[][];
  rows: number;
  _rateLimit?: RateLimitInfo | null;
}

// ── Opabinia: Pagination ──────────────────────────────────────────────
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

// ── Opabinia: Solana params ───────────────────────────────────────────
export interface SolanaTokensParams extends PaginationParams {}

export interface SolanaPoolAddressParams {
  pool_address: string;
}

export interface SolanaTokenAddressParams {
  token_address: string;
}

export interface SolanaMultiTokenAddressParams {
  token_addresses: string;
}

export interface SolanaOhlcvParams {
  token_address: string;
  after_time: number;
  before_time: number;
  interval: string;
}

export interface SolanaOhlcvBaseQuoteParams {
  base_address: string;
  quote_address: string;
  after_time: number;
  before_time: number;
  interval: string;
}

export interface SolanaOhlcvPoolParams {
  pool_address: string;
  after_time: number;
  before_time: number;
  interval: string;
}

export interface SolanaPriceHourParams {
  token_address: string;
  interval: string;
  limit?: number;
  offset?: number;
}

export interface SolanaPriceUnixParams {
  token_address: string;
  unixtime: string;
}

export interface SolanaPriceVolumeParams {
  token_address: string;
  timeframe: string;
}

export interface SolanaPriceVolumeMultiParams {
  token_addresses: string;
  timeframe: string;
}

export interface SolanaHolderTokenBalancesParams extends PaginationParams {
  wallet_address: string;
}

export interface SolanaPoolTransactionsParams extends PaginationParams {
  pool_address: string;
  days: number;
}

export interface SolanaPoolTransactionsTimeBoundedParams extends PaginationParams {
  pool_address: string;
  after_time: number;
  before_time: number;
}

export interface SolanaTokenTransactionsParams extends PaginationParams {
  token_address: string;
  days: number;
  after_time?: number;
  before_time?: number;
  tx_type?: string;
  dex?: string;
  pool_address?: string;
  min_value_usd?: number;
}

export interface SolanaTokenTransactionsTimeBoundedParams extends PaginationParams {
  token_address: string;
  after_time: number;
  before_time: number;
}

export interface SolanaTokenMintBurnParams extends PaginationParams {
  token_address: string;
  after_time: number;
  before_time: number;
  order_asc?: string[];
  order_desc?: string[];
}

export interface SolanaTokenPoolSearchParams extends PaginationParams {
  token_address: string;
}

export interface SolanaTradeStatisticsParams {
  token_addresses: string;
  timeframe: string;
}

export interface SolanaTraderLeaderboardParams {
  token_address: string;
  interval: string;
}

export interface SolanaTrendingTokensParams extends PaginationParams {
  order_by?: string;
}

export interface SolanaWalletBalanceHistoryParams extends PaginationParams {
  wallet_address: string;
  token_address: string;
  after_time: number;
  before_time: number;
  order_asc?: string[];
  order_desc?: string[];
}

export interface SolanaTokenHoldersParams extends PaginationParams {
  program_id: string;
}

export interface SolanaTokenHoldersOverTimeParams extends PaginationParams {
  token_address: string;
  start_block: number;
  end_block: number;
  interval: number;
}

export interface SolanaTokenHolderDistributionOverTimeParams extends PaginationParams {
  token_address: string;
  start_block: number;
  end_block: number;
  interval: number;
}

export interface SolanaMeteoraPoolParams {
  pool_address: string;
}

export interface SolanaMeteoraPoolMultiParams {
  pool_addresses: string;
}

export interface SolanaMeteoraPoolsParams extends PaginationParams {}

export interface SolanaRaydiumPoolParams {
  pool_address: string;
}

export interface SolanaRaydiumPoolMultiParams {
  pool_addresses: string;
}

export interface SolanaRaydiumPoolsParams extends PaginationParams {}

export interface SolanaOrcaPoolsParams extends PaginationParams {}

export interface SolanaOrcaPoolParams {
  pool_address: string;
}

export interface SolanaOrcaPoolMultiParams {
  pool_addresses: string;
}

export interface SolanaOrcaFeeMetricsParams {
  pool_address: string;
  days: number;
}

export interface SolanaOrcaFeeRangesParams {
  pool_address: string;
}

export interface SolanaOrcaHistoricalDataParams {
  pool_address: string;
  days: number;
}

export interface SolanaOrcaLiquidityMapParams {
  pool_address: string;
  resolution: number;
}

// ── Opabinia: EVM params ──────────────────────────────────────────────
export interface EvmPriceCurrentParams {
  token_address?: string;
}

export interface EvmPriceHourParams {
  token_address: string;
  hours: number;
}

export interface EvmTvlStatusParams {
  wallet_address: string;
  whitelisted?: boolean;
}

export interface EvmTvlTopOwnersParams extends PaginationParams {
  token_address: string;
}

export interface EvmPoolsParams extends PaginationParams {
  token_address?: string;
  order_asc?: string[];
  order_desc?: string[];
}

export interface EvmPoolParams {
  pool_address: string;
}

export interface EvmAeroV2PoolParams {
  pool_address: string;
  apr_days_annualized: number;
}

export interface EvmAeroV2PoolVolumeParams {
  pool_address: string;
}

export interface EvmAeroV2FeeMetricsParams {
  pool_address: string;
}

export interface EvmAeroV2ProvidersParams extends PaginationParams {}

export interface EvmAeroV2ProviderPositionsParams {
  wallet_address: string;
  order_asc?: string[];
  order_desc?: string[];
}

export interface EvmAeroV2ProviderSummaryParams {
  wallet_address: string;
}

export interface EvmAeroV2PoolsParams extends PaginationParams {}

// ── Deep42 params ─────────────────────────────────────────────────────
export interface Deep42AgentQuestionParams {
  question: string;
}

export interface Deep42AlphaTweetParams {
  limit?: number;
  token_filter?: string;
}

export interface Deep42InfluencerCredibilityParams {
  min_tweets?: number;
  limit?: number;
  token_focus?: string;
  sort_by?: string;
  order?: string;
  time_window?: string;
}

export interface Deep42SentimentShiftsParams {
  comparison_period?: string;
  limit?: number;
}

export interface Deep42TrendingMomentumParams {
  momentum_threshold?: number;
  timeframe?: string;
  limit?: number;
  include_volume?: boolean;
  include_sentiment?: boolean;
  sort_by?: string;
  order?: string;
}

export interface Deep42TokenAnalysisParams {
  token_symbol?: string;
  tokens?: string;
  timeframe?: string;
  include_sentiment?: boolean;
  include_influencers?: boolean;
  include_trends?: boolean;
  include_volume?: boolean;
  include_keywords?: boolean;
}

export interface Deep42ProjectMetadataParams {
  project_symbols?: string;
  chain?: string;
  min_confidence?: number;
  include_social?: boolean;
  include_technology?: boolean;
  include_trending?: boolean;
  include_timeline?: boolean;
  include_risk?: boolean;
  validation_status?: string;
  timeframe?: string;
  sort_by?: string;
  limit?: number;
  has_github?: boolean;
  order?: string;
  offset?: number;
}

export interface Deep42SearchProjectsParams {
  query?: string;
  technology?: string;
  category?: string;
  social_activity?: string;
  limit?: number;
  chain?: string;
  contract_address?: string;
  website_url?: string;
  force_discovery?: boolean;
  has_github?: boolean;
  twitter_url?: string;
  github_url?: string;
}

export interface Deep42SocialAssociationsParams {
  project_id: string;
}

export interface Deep42RepositoryMarketDataParams {
  repository: string;
  include_market_data?: boolean;
  include_dev_metrics?: boolean;
  timeframe?: string;
}

export interface Deep42IntelligenceParams {
  question: string;
}

export interface Deep42DeveloperActivityParams {
  mode?: string;
  project_symbol?: string;
  limit?: number;
  offset?: number;
  days_back?: number;
}

export interface Deep42ToolsAlphaTweetParams {
  limit?: number;
  token_filter?: string;
}

export interface Deep42ContentGenerationParams {
  question: string;
}

// ── Risk params ───────────────────────────────────────────────────────
export interface LiquidationRiskParams {
  token_address: string;
  entry_price: number;
  leverage: number;
  direction: 'long' | 'short';
  risk_horizon: '1h' | '1d' | '1w' | '1mo';
}

export interface LiquidationRiskResponse {
  status: string;
  riskProbability: number;
  liquidationPrice: number;
  entryPrice: number;
  volatility: number;
  drift: number;
  priceChangeNeeded: number;
  sigmasAway: number;
  simulationDetails: {
    totalSimulations: number;
    liquidatedPaths: number;
    dataPointsUsed: number;
    dataInterval: string;
    riskHorizon: string;
  };
  visualizationData: Record<string, unknown>;
  _rateLimit?: RateLimitInfo | null;
}
