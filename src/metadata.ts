import specData from './generated/openapi-params.json';

export type CambrianGroup = 'solana' | 'base' | 'deep42' | 'risk';
export type CambrianApiGroup = 'solana' | 'evm' | 'deep42' | 'risk';

export interface ParamSpec {
  required: boolean;
  type: string;
  enum?: string[];
  default?: unknown;
  min?: number;
  max?: number;
  description?: string;
  pattern?: string;
  items?: Record<string, unknown> & {
    type?: string;
    enum?: string[];
    min?: number;
    max?: number;
    pattern?: string;
  };
  minItems?: number;
  maxItems?: number;
  style?: string;
  explode?: boolean;
  /** Enables strict validation for normalized authoritative OpenAPI metadata. */
  strict?: boolean;
}

export interface EndpointSpec {
  apiPath: string;
  method: string;
  params: Record<string, ParamSpec>;
}

export type GroupSpec = Record<string, EndpointSpec>;

export interface CambrianToolParameter {
  name: string;
  cliFlag: string;
  required: boolean;
  spec: ParamSpec;
}

export interface CambrianToolMetadata {
  name: string;
  group: CambrianGroup;
  apiGroup: CambrianApiGroup;
  resource: string;
  apiPath: string;
  method: string;
  description: string;
  params: CambrianToolParameter[];
}

export interface CambrianMetadataGroup {
  group: CambrianGroup;
  apiGroup: CambrianApiGroup;
  resources: string[];
  spec: GroupSpec;
  cliDefaults: Record<string, Record<string, string>>;
}

const rawSpec = specData as {
  solana: GroupSpec;
  evm: GroupSpec;
  deep42: GroupSpec;
  risk: GroupSpec;
};

// Backward-compatible CLI conveniences. Runtime metadata retains these only
// while the active OpenAPI parameter schema accepts the value and declares no
// authoritative default of its own.
export const SOLANA_CLI_DEFAULTS: Record<string, Record<string, string>> = {
  'orca-pools': { dex: 'orca' },
  'trending-tokens': { order_by: 'volume_usd_24h' },
};

export const EVM_CLI_DEFAULTS: Record<string, Record<string, string>> = {
  'aero-v2-pool': { apr_days_annualized: '30' },
};

export const DEEP42_CLI_DEFAULTS: Record<string, Record<string, string>> = {};
export const RISK_CLI_DEFAULTS: Record<string, Record<string, string>> = {};

export const CAMBRIAN_HOSTED_MCP_URL =
  'https://cambrian-mcp-server-prod-981646676182.us-central1.run.app/mcp';

export const CAMBRIAN_MCP_PACKAGE = 'cambrian-api-mcp';
export const CAMBRIAN_MCP_SERVER_NAME = 'cambrian';
export const CAMBRIAN_MCP_REGISTRY_NAME = 'io.github.cambriannetwork/cambrian-api';

export const CAMBRIAN_METADATA_GROUPS: Record<CambrianGroup, CambrianMetadataGroup> = {
  solana: {
    group: 'solana',
    apiGroup: 'solana',
    resources: Object.keys(rawSpec.solana),
    spec: rawSpec.solana,
    cliDefaults: SOLANA_CLI_DEFAULTS,
  },
  base: {
    group: 'base',
    apiGroup: 'evm',
    resources: Object.keys(rawSpec.evm),
    spec: rawSpec.evm,
    cliDefaults: EVM_CLI_DEFAULTS,
  },
  deep42: {
    group: 'deep42',
    apiGroup: 'deep42',
    resources: Object.keys(rawSpec.deep42),
    spec: rawSpec.deep42,
    cliDefaults: DEEP42_CLI_DEFAULTS,
  },
  risk: {
    group: 'risk',
    apiGroup: 'risk',
    resources: Object.keys(rawSpec.risk),
    spec: rawSpec.risk,
    cliDefaults: RISK_CLI_DEFAULTS,
  },
};

export const DEEP42_RESOURCE_ALIASES: Record<string, string> = {
  'alpha-tweet-detection': 'social-data/alpha-tweet-detection',
  'alpha-tweets': 'social-data/alpha-tweet-detection',
  'influencer-credibility': 'social-data/influencer-credibility',
  'sentiment-shifts': 'social-data/sentiment-shifts',
  'token-analysis': 'social-data/token-analysis',
  'trending-momentum': 'social-data/trending-momentum',
};

export function buildCambrianToolName(group: CambrianGroup, resource: string): string {
  const normalizedResource = resource
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `cambrian_${group}_${normalizedResource}`;
}

function titleizeResource(resource: string): string {
  return resource.replace(/[/-]/g, ' ');
}

export function buildCambrianToolMetadata(group: CambrianGroup, resource: string): CambrianToolMetadata {
  const groupMetadata = CAMBRIAN_METADATA_GROUPS[group];
  const endpoint = groupMetadata.spec[resource];
  if (!endpoint) {
    throw new Error(`Unknown Cambrian ${group} resource: ${resource}`);
  }
  const defaults = groupMetadata.cliDefaults[resource] ?? {};
  const params = Object.entries(endpoint.params).map(([name, spec]) => ({
    name,
    cliFlag: name.replace(/_/g, '-'),
    required: spec.required === true && !(name in defaults) && spec.default === undefined,
    spec,
  }));
  return {
    name: buildCambrianToolName(group, resource),
    group,
    apiGroup: groupMetadata.apiGroup,
    resource,
    apiPath: endpoint.apiPath,
    method: endpoint.method,
    description: `Query Cambrian ${group} ${titleizeResource(resource)} data.`,
    params,
  };
}

export function listCambrianTools(): CambrianToolMetadata[] {
  return (Object.keys(CAMBRIAN_METADATA_GROUPS) as CambrianGroup[]).flatMap((group) =>
    CAMBRIAN_METADATA_GROUPS[group].resources.map((resource) =>
      buildCambrianToolMetadata(group, resource),
    ),
  );
}

export const CAMBRIAN_MCP_TOOLS = listCambrianTools();

export function getCambrianToolByName(name: string): CambrianToolMetadata | undefined {
  return CAMBRIAN_MCP_TOOLS.find((tool) => tool.name === name);
}

export function getCambrianToolByGroupResource(
  group: CambrianGroup,
  resource: string,
): CambrianToolMetadata | undefined {
  const resolvedResource = group === 'deep42' ? DEEP42_RESOURCE_ALIASES[resource] ?? resource : resource;
  return CAMBRIAN_MCP_TOOLS.find((tool) => tool.group === group && tool.resource === resolvedResource);
}
