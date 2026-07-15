import type { ParsedArgs, Runtime } from './core.js';
import type { CambrianData } from '../client/index.js';
import {
  deriveCliMetadata,
  handleDynamicQuery,
  buildCategorizedHelp,
  DATA_OUTPUT_GLOBAL_OPTIONS,
} from './dynamic-handler.js';
import { CAMBRIAN_METADATA_GROUPS, type CambrianMetadataGroup } from '../metadata.js';

// ── Load spec and derive CLI metadata ────────────────────────────

const { spec, cliDefaults: SOLANA_CLI_DEFAULTS } = CAMBRIAN_METADATA_GROUPS.solana;

const { resources, allowedOptions, requiredOptions } = deriveCliMetadata(spec, SOLANA_CLI_DEFAULTS);

export const SOLANA_RESOURCES = resources;
export const SOLANA_ALLOWED_OPTIONS = allowedOptions;
export const SOLANA_REQUIRED_OPTIONS = requiredOptions;

// ── Categorized help ─────────────────────────────────────────────

const SOLANA_GLOBAL_OPTIONS = ['help', 'api-key', 'base-url', 'json', 'timeout', 'retries', 'offline', ...DATA_OUTPUT_GLOBAL_OPTIONS];

function getSolanaCategory(resource: string): string {
  if (resource.startsWith('meteora-dlmm')) return 'Pools - Meteora DLMM';
  if (resource.startsWith('raydium-clmm')) return 'Pools - Raydium CLMM';
  if (resource.startsWith('orca')) return 'Pools - Orca';
  if (resource === 'tokens' || resource.startsWith('tokens-')) return 'Tokens';
  if (resource.startsWith('token-details') || resource === 'token-pool-search') return 'Token Details';
  if (resource.startsWith('ohlcv')) return 'OHLCV';
  if (resource.startsWith('price')) return 'Prices';
  if (resource.includes('transaction')) return 'Transactions';
  if (['trade-statistics', 'traders-leaderboard', 'trending-tokens'].includes(resource)) return 'Trade Stats';
  if (resource.includes('wallet') || resource === 'holder-token-balances') return 'Wallets';
  if (resource === 'latest-block') return 'Block';
  return 'Other';
}

const SOLANA_CATEGORY_ORDER = [
  'Pools - Meteora DLMM',
  'Pools - Raydium CLMM',
  'Pools - Orca',
  'Tokens',
  'Token Details',
  'OHLCV',
  'Prices',
  'Transactions',
  'Trade Stats',
  'Wallets',
  'Block',
];

function solanaHelp(currentResources: string[]): string {
  return buildCategorizedHelp(currentResources, getSolanaCategory, 'solana', {
    categoryOrder: SOLANA_CATEGORY_ORDER,
  });
}

// ── Handler ──────────────────────────────────────────────────────

export async function handleSolanaQuery(
  resource: string,
  parsed: ParsedArgs,
  runtime: Runtime,
  client: CambrianData,
  metadata: CambrianMetadataGroup = CAMBRIAN_METADATA_GROUPS.solana,
): Promise<number> {
  const currentSpec = metadata.spec;
  const currentDefaults = metadata.cliDefaults;
  const current = deriveCliMetadata(currentSpec, currentDefaults);
  return handleDynamicQuery(
    resource,
    parsed,
    runtime,
    (path, params) => client.opabinia.query(path, params),
    currentSpec,
    'solana',
    SOLANA_GLOBAL_OPTIONS,
    currentDefaults,
    current.allowedOptions,
    current.requiredOptions,
    () => solanaHelp(current.resources),
  );
}
