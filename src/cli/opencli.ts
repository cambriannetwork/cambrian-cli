import { readPackageVersion } from './core.js';
import {
  CAMBRIAN_METADATA_GROUPS,
  type CambrianGroup,
  type CambrianMetadataGroup,
} from '../metadata.js';
import { deriveCliMetadata } from './dynamic-handler.js';

const OPENCLI_SCHEMA_VERSION = '0.1.0';

function buildOpenCliInfo(version: string) {
  return {
    title: 'cambrian',
    summary: 'Server-backed DeFi and social intelligence CLI for AI agents and operators.',
    description:
      'Query Solana DeFi data (pools, tokens, prices, transactions), Base chain DeFi data (Aero, Alien, Sushi, Uniswap, Pancake pools, TVL), Deep42 social intelligence (alpha tweets, influencer credibility, sentiment shifts, token analysis, trending momentum), and perpetual risk engine data from the Cambrian API.',
    version,
    license: {
      identifier: 'MIT',
    },
    contact: {
      url: 'https://github.com/cambriannetwork/cambrian-cli',
    },
  };
}

const OPENCLI_CONVENTIONS = {
  groupOptions: false,
  optionArgumentSeparator: ' ',
};

const OPENCLI_OPTIONS = [
  { name: 'help', description: 'Show command help.' },
  { name: 'version', description: 'Print the package version.' },
];

const DATA_OPTIONS = [
  {
    name: 'api-key',
    recursive: true,
    arguments: [{ name: 'api-key', required: true }],
    description: 'API key. Defaults to CAMBRIAN_API_KEY or stored config.',
  },
  { name: 'json', recursive: true, description: 'Emit machine-readable JSON errors.' },
  {
    name: 'output',
    recursive: true,
    arguments: [{ name: 'format', required: true, acceptedValues: ['json', 'table', 'tsv'] }],
    description: 'Select the output format.',
  },
  {
    name: 'fields',
    recursive: true,
    arguments: [{ name: 'fields', required: true }],
    description: 'Project comma-separated response fields.',
  },
  { name: 'all', recursive: true, description: 'Fetch every page for paginated resources.' },
  {
    name: 'max-items',
    recursive: true,
    arguments: [{ name: 'count', required: true }],
    description: 'Cap rows returned by --all.',
  },
  {
    name: 'timeout',
    recursive: true,
    arguments: [{ name: 'milliseconds', required: true }],
    description: 'Set the per-request timeout.',
  },
  {
    name: 'retries',
    recursive: true,
    arguments: [{ name: 'count', required: true }],
    description: 'Retry transient HTTP failures.',
  },
  {
    name: 'offline',
    recursive: true,
    description: 'Do not refresh endpoint metadata; data requests still require network.',
  },
];

const PAY_OPTIONS = [
  { name: 'yes', recursive: true, description: 'Authorize spending after the price preview.' },
  { name: 'json', recursive: true, description: 'Emit machine-readable JSON errors.' },
  {
    name: 'max-amount',
    recursive: true,
    arguments: [{ name: 'usd', required: true }],
    description: 'Set the maximum authorized USDC amount.',
  },
  {
    name: 'timeout',
    recursive: true,
    arguments: [{ name: 'milliseconds', required: true }],
    description: 'Set the gateway timeout.',
  },
  {
    name: 'output',
    recursive: true,
    arguments: [{ name: 'format', required: true, acceptedValues: ['json', 'table', 'tsv'] }],
    description: 'Select the output format.',
  },
  {
    name: 'fields',
    recursive: true,
    arguments: [{ name: 'fields', required: true }],
    description: 'Project comma-separated response fields.',
  },
  {
    name: 'offline',
    recursive: true,
    description: 'Do not refresh endpoint metadata; payment requests still require network.',
  },
];

const OPENCLI_EXIT_CODES = [
  { code: 0, description: 'Command completed successfully.' },
  { code: 1, description: 'Command failed during execution.' },
  { code: 2, description: 'Invalid arguments or missing configuration.' },
];

function buildSubcommands(
  resources: readonly string[],
  group: string,
  allowedOpts?: Record<string, string[]>,
  requiredOpts?: Record<string, string[]>,
) {
  return resources.map((name) => {
    const allowed = allowedOpts?.[name] ?? [];
    const requiredSet = new Set(requiredOpts?.[name] ?? []);
    return {
      name,
      description: `Query ${group} ${name.replace(/-/g, ' ')} data.`,
      ...(allowed.length > 0 && {
        options: allowed.map((flag) => ({
          name: flag,
          required: requiredSet.has(flag),
        })),
      }),
    };
  });
}

function option(name: string, argument?: string) {
  return {
    name,
    ...(argument && { arguments: [{ name: argument, required: true }] }),
  };
}

export function buildOpenCliDocument(
  metadataGroups: Record<CambrianGroup, CambrianMetadataGroup> = CAMBRIAN_METADATA_GROUPS,
) {
  const version = readPackageVersion();
  const solana = deriveCliMetadata(
    metadataGroups.solana.spec,
    metadataGroups.solana.cliDefaults,
  );
  const base = deriveCliMetadata(
    metadataGroups.base.spec,
    metadataGroups.base.cliDefaults,
  );
  const deep42 = deriveCliMetadata(
    metadataGroups.deep42.spec,
    metadataGroups.deep42.cliDefaults,
  );
  const risk = deriveCliMetadata(
    metadataGroups.risk.spec,
    metadataGroups.risk.cliDefaults,
  );
  return {
    opencli: OPENCLI_SCHEMA_VERSION,
    info: buildOpenCliInfo(version),
    conventions: OPENCLI_CONVENTIONS,
    authentication: {
      required: true,
      env: 'CAMBRIAN_API_KEY',
      flag: '--api-key',
    },
    options: [...OPENCLI_OPTIONS],
    exitCodes: [...OPENCLI_EXIT_CODES],
    commands: [
      {
        name: 'solana',
        description: `Query Solana DeFi endpoints (${solana.resources.length} resources).`,
        options: DATA_OPTIONS,
        commands: buildSubcommands(solana.resources, 'Solana', solana.allowedOptions, solana.requiredOptions),
      },
      {
        name: 'base',
        aliases: ['evm'],
        description: `Query Base chain DeFi endpoints (${base.resources.length} resources).`,
        options: DATA_OPTIONS,
        commands: buildSubcommands(base.resources, 'Base', base.allowedOptions, base.requiredOptions),
      },
      {
        name: 'deep42',
        description: `Query Deep42 social intelligence endpoints (${deep42.resources.length} resources).`,
        options: DATA_OPTIONS,
        commands: buildSubcommands(deep42.resources, 'Deep42', deep42.allowedOptions, deep42.requiredOptions),
      },
      {
        name: 'risk',
        description: 'Query perpetual risk engine.',
        options: DATA_OPTIONS,
        commands: buildSubcommands(risk.resources, 'Risk', risk.allowedOptions, risk.requiredOptions),
      },
      {
        name: 'pay',
        description: 'Make an x402 pay-per-call request using Base USDC.',
        options: PAY_OPTIONS,
        commands: [
          { name: 'solana', commands: buildSubcommands(solana.resources, 'Solana', solana.allowedOptions, solana.requiredOptions) },
          { name: 'base', aliases: ['evm'], commands: buildSubcommands(base.resources, 'Base', base.allowedOptions, base.requiredOptions) },
          { name: 'deep42', commands: buildSubcommands(deep42.resources, 'Deep42', deep42.allowedOptions, deep42.requiredOptions) },
          { name: 'risk', commands: buildSubcommands(risk.resources, 'Risk', risk.allowedOptions, risk.requiredOptions) },
        ],
      },
      {
        name: 'docs',
        description: 'Read live Cambrian API documentation and dynamically indexed guides.',
        options: [{
          name: 'offline',
          recursive: true,
          description: 'Use schema-derived docs without fetching documentation.',
        }],
        commands: [
          {
            name: 'guides',
            description: 'List live guides or fetch one by its indexed URL slug.',
          },
          { name: 'solana', commands: buildSubcommands(solana.resources, 'Solana') },
          { name: 'base', aliases: ['evm'], commands: buildSubcommands(base.resources, 'Base') },
          { name: 'deep42', commands: buildSubcommands(deep42.resources, 'Deep42') },
          { name: 'risk', commands: buildSubcommands(risk.resources, 'Risk') },
        ],
      },
      {
        name: 'config',
        description: 'Manage the persisted API key.',
        commands: [
          { name: 'status', description: 'Check API-key configuration without exposing the secret.' },
          { name: 'set-key', description: 'Persist an API key; command arguments may remain in shell history.', arguments: [{ name: 'key', required: true }] },
          { name: 'get-key', description: 'Compatibility command that prints the full stored secret.' },
          { name: 'clear' },
        ],
      },
      {
        name: 'completion',
        description: 'Print a shell completion script.',
        commands: ['bash', 'zsh', 'fish'].map((name) => ({ name })),
      },
      {
        name: 'schema',
        description: 'Inspect and refresh the authoritative runtime endpoint registry.',
        commands: [
          {
            name: 'status',
            description: 'Show bundled, cached, and live registry status.',
            options: [option('offline')],
          },
          { name: 'refresh', description: 'Refresh validated runtime schema when its 15-minute source cooldown is due.' },
          { name: 'clear-cache', description: 'Remove cached runtime metadata without clearing source request cooldowns.' },
        ],
      },
      {
        name: 'skill',
        description: 'Manage skill bundles for AI agent tools.',
        commands: [
          {
            name: 'install',
            description: 'Install skill bundle to detected tool directories.',
            options: [option('tool', 'tool'), option('path', 'directory')],
          },
          {
            name: 'print',
            description: 'Print the skill markdown or adapter content.',
            options: [option('adapter', 'adapter')],
          },
          { name: 'targets', description: 'List known skill install targets.' },
        ],
      },
      {
        name: 'mcp',
        description: 'Configure, install, and test Cambrian MCP integrations.',
        commands: [
          {
            name: 'config',
            description: 'Print MCP client configuration.',
            options: [option('client', 'client'), option('mode', 'mode'), option('url', 'url')],
          },
          {
            name: 'install',
            description: 'Install Cambrian MCP into supported clients.',
            options: [
              option('client', 'client'), option('mode', 'mode'), option('url', 'url'),
              option('api-key', 'api-key'), option('dry-run'),
            ],
          },
          {
            name: 'test',
            description: 'Run a real initialize and tool-list connectivity smoke test.',
            options: [option('mode', 'mode'), option('url', 'url'), option('api-key', 'api-key')],
          },
        ],
      },
      {
        name: 'describe',
        description: 'Machine-readable self-description.',
        commands: [
          {
            name: 'opencli',
            description: 'Emit the OpenCLI JSON document.',
            options: [option('offline')],
          },
        ],
      },
    ],
  };
}
