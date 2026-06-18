import type { ParsedArgs, Runtime } from './core.js';
import type { CambrianData } from '../client/index.js';
import {
  deriveCliMetadata,
  handleDynamicQuery,
  buildCategorizedHelp,
  DATA_OUTPUT_GLOBAL_OPTIONS,
} from './dynamic-handler.js';
import { CAMBRIAN_METADATA_GROUPS } from '../metadata.js';

// ── Load spec and derive CLI metadata ────────────────────────────

const { spec, cliDefaults: EVM_CLI_DEFAULTS } = CAMBRIAN_METADATA_GROUPS.base;

const { resources, allowedOptions, requiredOptions } = deriveCliMetadata(spec, EVM_CLI_DEFAULTS);

export const EVM_RESOURCES = resources;
export const EVM_ALLOWED_OPTIONS = allowedOptions;
export const EVM_REQUIRED_OPTIONS = requiredOptions;

// ── Categorized help ─────────────────────────────────────────────

const EVM_GLOBAL_OPTIONS = ['help', 'api-key', 'base-url', 'json', 'timeout', 'retries', ...DATA_OUTPUT_GLOBAL_OPTIONS];

function getEvmCategory(resource: string): string {
  if (resource.startsWith('aero-v2')) return 'Aerodrome V2';
  if (resource.startsWith('aero-v3')) return 'Aerodrome V3';
  if (resource.startsWith('uniswap')) return 'Uniswap V3';
  if (resource.startsWith('sushi')) return 'SushiSwap V3';
  if (resource.startsWith('pancake')) return 'PancakeSwap V3';
  if (resource.startsWith('alien')) return 'Alienbase V3';
  if (resource.startsWith('clones')) return 'Clones V3';
  if (resource.startsWith('tvl')) return 'TVL';
  if (resource.startsWith('price')) return 'Prices';
  return 'Discovery';
}

const EVM_CATEGORY_ORDER = [
  'Aerodrome V2',
  'Aerodrome V3',
  'Uniswap V3',
  'SushiSwap V3',
  'PancakeSwap V3',
  'Alienbase V3',
  'Clones V3',
  'TVL',
  'Discovery',
  'Prices',
];

function evmHelp(): string {
  return buildCategorizedHelp(resources, getEvmCategory, 'base', {
    extraLines: ['Aliases: cambrian evm'],
    categoryOrder: EVM_CATEGORY_ORDER,
  });
}

// ── Handler ──────────────────────────────────────────────────────

export async function handleEvmQuery(
  resource: string,
  parsed: ParsedArgs,
  runtime: Runtime,
  client: CambrianData,
): Promise<number> {
  return handleDynamicQuery(
    resource,
    parsed,
    runtime,
    (path, params) => client.opabinia.query(path, params),
    spec,
    'base',
    EVM_GLOBAL_OPTIONS,
    EVM_CLI_DEFAULTS,
    allowedOptions,
    requiredOptions,
    evmHelp,
  );
}
