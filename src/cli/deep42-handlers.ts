import type { ParsedArgs, Runtime } from './core.js';
import type { CambrianData } from '../client/index.js';
import {
  deriveCliMetadata,
  handleDynamicQuery,
  buildCategorizedHelp,
  DATA_OUTPUT_GLOBAL_OPTIONS,
} from './dynamic-handler.js';
import { CAMBRIAN_METADATA_GROUPS, DEEP42_RESOURCE_ALIASES } from '../metadata.js';

// ── Load spec and derive CLI metadata ────────────────────────────

const { spec, cliDefaults: DEEP42_CLI_DEFAULTS } = CAMBRIAN_METADATA_GROUPS.deep42;

const { resources, allowedOptions, requiredOptions } = deriveCliMetadata(spec, DEEP42_CLI_DEFAULTS);

export const DEEP42_RESOURCES = resources;
export const DEEP42_ALLOWED_OPTIONS = allowedOptions;
export const DEEP42_REQUIRED_OPTIONS = requiredOptions;

// ── Categorized help ─────────────────────────────────────────────

const DEEP42_GLOBAL_OPTIONS = ['help', 'api-key', 'base-url', 'json', 'timeout', 'retries', ...DATA_OUTPUT_GLOBAL_OPTIONS];

function getDeep42Category(resource: string): string {
  if (resource.startsWith('discovery/')) return 'Discovery';
  if (resource.startsWith('social-data/')) return 'Social Data';
  return 'Other';
}

function deep42Help(): string {
  // Derive the alias list from the registry so it never drifts from the actual aliases.
  const aliases = Object.keys(DEEP42_RESOURCE_ALIASES);
  const aliasLines: string[] = [];
  for (let i = 0; i < aliases.length; i += 4) {
    aliasLines.push('  ' + aliases.slice(i, i + 4).join(', '));
  }
  return buildCategorizedHelp(resources, getDeep42Category, 'deep42', {
    categoryOrder: ['Social Data', 'Discovery'],
    extraLines: ['Aliases:', ...aliasLines],
  });
}

// ── Handler ──────────────────────────────────────────────────────

export async function handleDeep42Query(
  resource: string,
  parsed: ParsedArgs,
  runtime: Runtime,
  client: CambrianData,
): Promise<number> {
  const resolvedResource = DEEP42_RESOURCE_ALIASES[resource] ?? resource;
  return handleDynamicQuery(
    resolvedResource,
    parsed,
    runtime,
    (path, params) => client.deep42.query(path, params as Record<string, string | number | boolean | undefined>),
    spec,
    'deep42',
    DEEP42_GLOBAL_OPTIONS,
    DEEP42_CLI_DEFAULTS,
    allowedOptions,
    requiredOptions,
    deep42Help,
  );
}
