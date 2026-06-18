import type { ParsedArgs, Runtime } from './core.js';
import type { CambrianData } from '../client/index.js';
import {
  deriveCliMetadata,
  handleDynamicQuery,
  DATA_OUTPUT_GLOBAL_OPTIONS,
} from './dynamic-handler.js';
import { CAMBRIAN_METADATA_GROUPS } from '../metadata.js';

// ── Load spec and derive CLI metadata ────────────────────────────

const { spec, cliDefaults: RISK_CLI_DEFAULTS } = CAMBRIAN_METADATA_GROUPS.risk;

const { resources, allowedOptions, requiredOptions } = deriveCliMetadata(spec, RISK_CLI_DEFAULTS);

export const RISK_RESOURCES = resources;
export const RISK_ALLOWED_OPTIONS = allowedOptions;
export const RISK_REQUIRED_OPTIONS = requiredOptions;

// ── Help ─────────────────────────────────────────────────────────

const RISK_GLOBAL_OPTIONS = ['help', 'api-key', 'base-url', 'json', 'timeout', 'retries', ...DATA_OUTPUT_GLOBAL_OPTIONS];

function riskHelp(): string {
  return [
    'Usage:',
    '  cambrian risk <resource> [options]',
    '',
    'Resources:',
    ...resources.map((r) => `  ${r}`),
    '',
    'Global options:',
    '  --api-key <key>    API key (falls back to CAMBRIAN_API_KEY).',
    '  --help             Show this help.',
  ].join('\n');
}

// ── Handler ──────────────────────────────────────────────────────

export async function handleRiskQuery(
  resource: string,
  parsed: ParsedArgs,
  runtime: Runtime,
  client: CambrianData,
): Promise<number> {
  return handleDynamicQuery(
    resource,
    parsed,
    runtime,
    (path, params) => client.risk.query(path, params),
    spec,
    'risk',
    RISK_GLOBAL_OPTIONS,
    RISK_CLI_DEFAULTS,
    allowedOptions,
    requiredOptions,
    riskHelp,
  );
}
