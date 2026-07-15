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
        commands: buildSubcommands(solana.resources, 'Solana', solana.allowedOptions, solana.requiredOptions),
      },
      {
        name: 'base',
        aliases: ['evm'],
        description: `Query Base chain DeFi endpoints (${base.resources.length} resources).`,
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
        commands: buildSubcommands(base.resources, 'Base', base.allowedOptions, base.requiredOptions),
      },
      {
        name: 'deep42',
        description: `Query Deep42 social intelligence endpoints (${deep42.resources.length} resources).`,
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
        commands: buildSubcommands(deep42.resources, 'Deep42', deep42.allowedOptions, deep42.requiredOptions),
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
        commands: buildSubcommands(risk.resources, 'Risk', risk.allowedOptions, risk.requiredOptions),
      },
      {
        name: 'schema',
        description: 'Inspect and refresh the additive runtime endpoint registry.',
        commands: [
          { name: 'status', description: 'Show bundled, cached, and live registry status.' },
          { name: 'refresh', description: 'Force a safe runtime schema refresh.' },
          { name: 'clear-cache', description: 'Remove cached runtime endpoint additions.' },
        ],
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
