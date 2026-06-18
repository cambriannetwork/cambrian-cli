import { readPackageVersion, resolvePackageRoot } from './core.js';
import { SOLANA_RESOURCES, SOLANA_ALLOWED_OPTIONS, SOLANA_REQUIRED_OPTIONS } from './solana-handlers.js';
import { EVM_RESOURCES, EVM_ALLOWED_OPTIONS, EVM_REQUIRED_OPTIONS } from './evm-handlers.js';
import { DEEP42_RESOURCES, DEEP42_ALLOWED_OPTIONS, DEEP42_REQUIRED_OPTIONS } from './deep42-handlers.js';
import { RISK_RESOURCES, RISK_ALLOWED_OPTIONS, RISK_REQUIRED_OPTIONS } from './risk-handlers.js';

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

export function buildOpenCliDocument() {
  const version = readPackageVersion();
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
        description: `Query Solana DeFi endpoints (${SOLANA_RESOURCES.length} resources).`,
        options: [
          {
            name: 'api-key',
            recursive: true,
            arguments: [
              {
                name: 'api-key',
                required: true,
                description: 'API key. Defaults to CAMBRIAN_API_KEY.',
              },
            ],
            description: 'API key used for authenticated requests.',
          },
        ],
        commands: buildSubcommands(SOLANA_RESOURCES, 'Solana', SOLANA_ALLOWED_OPTIONS, SOLANA_REQUIRED_OPTIONS),
      },
      {
        name: 'base',
        aliases: ['evm'],
        description: `Query Base chain DeFi endpoints (${EVM_RESOURCES.length} resources).`,
        options: [
          {
            name: 'api-key',
            recursive: true,
            arguments: [
              {
                name: 'api-key',
                required: true,
                description: 'API key. Defaults to CAMBRIAN_API_KEY.',
              },
            ],
            description: 'API key used for authenticated requests.',
          },
        ],
        commands: buildSubcommands(EVM_RESOURCES, 'Base', EVM_ALLOWED_OPTIONS, EVM_REQUIRED_OPTIONS),
      },
      {
        name: 'deep42',
        description: `Query Deep42 social intelligence endpoints (${DEEP42_RESOURCES.length} resources).`,
        options: [
          {
            name: 'api-key',
            recursive: true,
            arguments: [
              {
                name: 'api-key',
                required: true,
                description: 'API key. Defaults to CAMBRIAN_API_KEY.',
              },
            ],
            description: 'API key used for authenticated requests.',
          },
        ],
        commands: buildSubcommands(DEEP42_RESOURCES, 'Deep42', DEEP42_ALLOWED_OPTIONS, DEEP42_REQUIRED_OPTIONS),
      },
      {
        name: 'risk',
        description: 'Query perpetual risk engine.',
        options: [
          {
            name: 'api-key',
            recursive: true,
            arguments: [
              {
                name: 'api-key',
                required: true,
                description: 'API key. Defaults to CAMBRIAN_API_KEY.',
              },
            ],
            description: 'API key used for authenticated requests.',
          },
        ],
        commands: buildSubcommands(RISK_RESOURCES, 'Risk', RISK_ALLOWED_OPTIONS, RISK_REQUIRED_OPTIONS),
      },
      {
        name: 'skill',
        description: 'Manage skill bundles for AI agent tools.',
        commands: [
          { name: 'install', description: 'Install skill bundle to detected tool directories.' },
          { name: 'print', description: 'Print the skill markdown or adapter content.' },
          { name: 'targets', description: 'List known skill install targets.' },
        ],
      },
      {
        name: 'mcp',
        description: 'Configure, install, and test Cambrian MCP integrations.',
        commands: [
          { name: 'config', description: 'Print MCP client configuration.' },
          { name: 'install', description: 'Install Cambrian MCP into supported clients.' },
          { name: 'test', description: 'Run an MCP connectivity smoke test.' },
        ],
      },
      {
        name: 'describe',
        description: 'Machine-readable self-description.',
        commands: [
          { name: 'opencli', description: 'Emit the OpenCLI JSON document.' },
        ],
      },
    ],
  };
}
