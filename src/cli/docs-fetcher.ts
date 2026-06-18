/**
 * Fetches documentation from docs.cambrian.org/llms.txt at the appropriate
 * level of specificity based on the command context.
 *
 * - `cambrian --help`                        → full llms.txt
 * - `cambrian solana --help`                 → Solana section from llms.txt
 * - `cambrian solana price-current --help`   → endpoint-specific llms.txt
 */

import { CAMBRIAN_METADATA_GROUPS, DEEP42_RESOURCE_ALIASES } from '../metadata.js';
import type { CambrianGroup, EndpointSpec, ParamSpec } from '../metadata.js';

const LLMS_BASE = 'https://docs.cambrian.org';
const LLMS_ROOT = `${LLMS_BASE}/llms.txt`;

// Map CLI group names to llms.txt section headers
const SECTION_HEADERS: Record<string, string> = {
  solana: '### Solana',
  evm: '### Evm',
  deep42: '### Deep42',
  risk: '### Perp risk engine',
};

// Map CLI resource names to API paths for endpoint-specific docs
// Solana: the CLI resource name maps to /api/v1/solana/<path>
// EVM: the CLI resource name maps to /api/v1/evm/<path>
// Deep42: handled dynamically (resource IS the path)
// Risk: single endpoint
function resourceToApiPath(group: string, resource: string): string | null {
  switch (group) {
    case 'solana':
      // CLI resource: "price-current" -> API path: "solana/price-current"
      // CLI resource: "orca-pool" -> API path: "solana/orca/pool"
      // CLI resource: "meteora-dlmm-pools" -> API path: "solana/meteora-dlmm/pools"
      // CLI resource: "ohlcv-token" -> API path: "solana/ohlcv/token"
      // CLI resource: "tokens-holders" -> API path: "solana/tokens/holders"
      return `solana/${cliResourceToUrlPath(resource)}`;

    case 'evm':
      // CLI resource: "chains" -> API path: "evm/chains"
      // CLI resource: "aero-v2-pool" -> API path: "evm/aero/v2/pool"
      // CLI resource: "uniswap-v3-pools" -> API path: "evm/uniswap/v3/pools"
      return `evm/${cliResourceToUrlPath(resource)}`;

    case 'deep42': {
      // Deep42 resources can be aliases or full paths
      const deep42Aliases: Record<string, string> = {
        'alpha-tweet-detection': 'social-data/alpha-tweet-detection',
        'alpha-tweets': 'social-data/alpha-tweet-detection',
        'influencer-credibility': 'social-data/influencer-credibility',
        'sentiment-shifts': 'social-data/sentiment-shifts',
      };
      const resolved = deep42Aliases[resource] ?? resource;
      return `deep42/${resolved}`;
    }

    case 'risk':
      return 'perp-risk-engine';

    default:
      return null;
  }
}

/**
 * Convert CLI kebab-case resource to URL path.
 * e.g. "orca-pool" -> "orca/pool"
 *      "aero-v2-pools" -> "aero/v2/pools"
 *      "tokens-holders" -> "tokens/holders"
 *      "ohlcv-base-quote" -> "ohlcv/base-quote"
 *
 * Strategy: try the endpoint-specific URL; if it 404s, try parent paths.
 */
function cliResourceToUrlPath(resource: string): string {
  // Known patterns where hyphens are NOT path separators
  const knownMappings: Record<string, string> = {
    // Solana pools
    'meteora-dlmm-pool': 'meteora-dlmm/pool',
    'meteora-dlmm-pool-multi': 'meteora-dlmm/pool-multi',
    'meteora-dlmm-pools': 'meteora-dlmm/pools',
    'raydium-clmm-pool': 'raydium-clmm/pool',
    'raydium-clmm-pool-multi': 'raydium-clmm/pool-multi',
    'raydium-clmm-pools': 'raydium-clmm/pools',
    'orca-pool': 'orca/pool',
    'orca-pool-multi': 'orca/pool-multi',
    'orca-pools': 'orca/pools',
    'orca-pools-fee-metrics': 'orca/pools/fee-metrics',
    'orca-pools-fee-ranges': 'orca/pools/fee-ranges',
    'orca-pools-historical-data': 'orca/pools/historical-data',
    'orca-pools-liquidity-map': 'orca/pools/liquidity-map',
    // Solana data
    'ohlcv-token': 'ohlcv/token',
    'ohlcv-pool': 'ohlcv/pool',
    'ohlcv-base-quote': 'ohlcv/base-quote',
    'price-current': 'price-current',
    'price-hour': 'price-hour',
    'price-multi': 'price-multi',
    'price-unix': 'price-unix',
    'price-volume-single': 'price-volume/single',
    'price-volume-multi': 'price-volume/multi',
    'token-details': 'token-details',
    'token-details-multi': 'token-details-multi',
    'token-pool-search': 'token-pool-search',
    'token-transactions': 'token-transactions',
    'token-transactions-time-bounded': 'token-transactions-time-bounded',
    'token-mint-burn-transactions': 'token-mint-burn-transactions',
    'pool-transactions': 'pool-transactions',
    'pool-transactions-time-bounded': 'pool-transactions-time-bounded',
    'trade-statistics': 'trade-statistics',
    'trending-tokens': 'trending-tokens',
    'latest-block': 'latest-block',
    'holder-token-balances': 'holder-token-balances',
    'wallet-balance-history': 'wallet-balance-history',
    'traders-leaderboard': 'traders/leaderboard',
    'tokens': 'tokens',
    'tokens-holders': 'tokens/holders',
    'tokens-holders-over-time': 'tokens/holders-over-time',
    'tokens-holder-distribution-over-time': 'tokens/holder-distribution-over-time',
    'tokens-security': 'tokens/security',
    // EVM pools
    'aero-v2-pool': 'aero/v2/pool',
    'aero-v2-pools': 'aero/v2/pools',
    'aero-v2-fee-metrics': 'aero/v2/fee-metrics',
    'aero-v2-pool-volume': 'aero/v2/pool-volume',
    'aero-v2-providers': 'aero/v2/providers',
    'aero-v2-provider-positions': 'aero/v2/provider-positions',
    'aero-v2-provider-summary': 'aero/v2/provider-summary',
    'aero-v3-pool': 'aero/v3/pool',
    'aero-v3-pools': 'aero/v3/pools',
    'alien-v3-pool': 'alien/v3/pool',
    'alien-v3-pools': 'alien/v3/pools',
    'sushi-v3-pool': 'sushi/v3/pool',
    'sushi-v3-pools': 'sushi/v3/pools',
    'clones-v3-pool': 'clones/v3/pool',
    'clones-v3-pools': 'clones/v3/pools',
    'pancake-v3-pool': 'pancake/v3/pool',
    'pancake-v3-pools': 'pancake/v3/pools',
    'uniswap-v3-pool': 'uniswap/v3/pool',
    'uniswap-v3-pools': 'uniswap/v3/pools',
    'tvl-status': 'tvl/status',
    'tvl-top': 'tvl/top',
    'tvl-top-owners': 'tvl/top-owners',
  };

  return knownMappings[resource] ?? resource;
}

/**
 * Extract a section from the full llms.txt content.
 * Sections start with ### headers.
 */
function extractSection(fullText: string, sectionHeader: string): string {
  const lines = fullText.split('\n');
  let inSection = false;
  const result: string[] = [];

  for (const line of lines) {
    // Stop at next H2 or H3 section
    if (inSection && (line.startsWith('### ') || line.startsWith('## '))) {
      break;
    }
    if (line === sectionHeader) {
      inSection = true;
      result.push(line);
      continue;
    }
    if (inSection) {
      result.push(line);
    }
  }

  return result.join('\n').trim();
}

export type FetchFn = typeof globalThis.fetch;

/**
 * Fetch help documentation from llms.txt.
 * On any network/HTTP failure the function falls back to schema-derived info
 * from the bundled OpenAPI params. Never throws.
 *
 * Returns the documentation text, or null only when no fallback is available
 * (e.g. root-level fetch with no group specified).
 */
export async function fetchDocs(
  fetchFn: FetchFn,
  group?: string,
  resource?: string,
): Promise<string | null> {
  try {
    // Level 3: specific endpoint docs
    if (group && resource) {
      const apiPath = resourceToApiPath(group, resource);
      if (apiPath) {
        const url = `${LLMS_BASE}/api/v1/${apiPath}/llms.txt`;
        let endpointText: string | null = null;
        try {
          const res = await fetchFn(url);
          if (res.ok) endpointText = await res.text();
        } catch {
          // network failure — proceed to root fallback below
        }
        if (endpointText) return endpointText;
        // Fall through: try root llms.txt, then schema fallback.
      }
    }

    // Level 1 or 2: fetch full llms.txt, then optionally extract section
    let fullText: string | null = null;
    try {
      const res = await fetchFn(LLMS_ROOT);
      if (res.ok) fullText = await res.text();
    } catch {
      // network failure — use schema fallback
    }

    if (fullText) {
      // Level 2: extract section for a specific group
      if (group && !resource) {
        const header = SECTION_HEADERS[group];
        if (header) {
          const section = extractSection(fullText, header);
          if (section) return section;
        }
      }
      // Level 1: full docs
      return fullText;
    }

    // Schema fallback: offline, derived from bundled OpenAPI params.
    return buildSchemaFallbackDocs(group, resource);
  } catch {
    // Last resort: try schema fallback, then null.
    return buildSchemaFallbackDocs(group, resource);
  }
}

// ── Schema-derived fallback (offline, from bundled OpenAPI schema) ──

// CLI group name -> metadata group key (evm/base both map to the `base` spec).
const GROUP_TO_METADATA_KEY: Record<string, CambrianGroup> = {
  solana: 'solana',
  evm: 'base',
  base: 'base',
  deep42: 'deep42',
  risk: 'risk',
};

function describeParam(name: string, ps: ParamSpec): string {
  const cliFlag = name.replace(/_/g, '-');
  const bits: string[] = [ps.type];
  if (ps.required) bits.push('required'); else bits.push('optional');
  if (ps.enum) bits.push(`one of: ${ps.enum.join(', ')}`);
  if (ps.default !== undefined) bits.push(`default: ${ps.default}`);
  if (ps.min !== undefined && ps.max !== undefined) bits.push(`range ${ps.min}-${ps.max}`);
  else if (ps.min !== undefined) bits.push(`min ${ps.min}`);
  else if (ps.max !== undefined) bits.push(`max ${ps.max}`);
  const meta = `  --${cliFlag}  (${bits.join(', ')})`;
  return ps.description ? `${meta}\n      ${ps.description}` : meta;
}

function renderEndpointSchema(group: string, resource: string, entry: EndpointSpec): string {
  const lines: string[] = [
    `# cambrian ${group} ${resource}`,
    '',
    '(Live docs unavailable — showing bundled schema. For full descriptions,',
    ' units, and response fields, retry `cambrian docs` when online or see',
    ` https://docs.cambrian.org/api/v1/${entry.apiPath.replace(/^\/api\/v1\//, '').replace(/^\//, '')}/llms.txt )`,
    '',
    `${entry.method} ${entry.apiPath}`,
    '',
  ];
  const params = Object.entries(entry.params);
  if (params.length === 0) {
    lines.push('Parameters: (none)');
  } else {
    lines.push('Parameters:');
    for (const [name, ps] of params) lines.push(describeParam(name, ps));
  }
  return lines.join('\n');
}

/**
 * Builds documentation from the bundled OpenAPI schema when the live llms.txt
 * fetch fails. Returns null if the group/resource can't be resolved from the
 * schema. Purely offline — never fetches, never throws.
 */
export function buildSchemaFallbackDocs(group?: string, resource?: string): string | null {
  try {
    if (!group) return null;
    const metadataKey = GROUP_TO_METADATA_KEY[group];
    if (!metadataKey) return null;
    const groupMeta = CAMBRIAN_METADATA_GROUPS[metadataKey];

    // Group-level fallback (no resource): list available resources.
    if (!resource) {
      const resources = groupMeta.resources;
      return [
        `# cambrian ${group}`,
        '',
        '(Live docs unavailable — showing bundled schema resource list.)',
        '',
        'Resources:',
        ...resources.map((r) => `  ${r}`),
        '',
        `Run "cambrian ${group} <resource> --help" for parameters.`,
      ].join('\n');
    }

    // Resolve Deep42 aliases (e.g. alpha-tweets -> social-data/...).
    const resolved =
      metadataKey === 'deep42'
        ? DEEP42_RESOURCE_ALIASES[resource] ?? resource
        : resource;

    const entry = groupMeta.spec[resolved];
    if (!entry) return null;
    return renderEndpointSchema(group, resource, entry);
  } catch {
    return null;
  }
}
