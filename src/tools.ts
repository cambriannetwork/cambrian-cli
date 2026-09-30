/**
 * Agent tool surface derived from the CLI: one tool per CLI command, validated,
 * defaulted, and serialized by the same code the CLI runs. MCP servers import
 * this so each CLI release changes their tools with no code of their own.
 */
import {
  buildCambrianToolMetadata,
  type CambrianGroup,
  type CambrianMetadataGroup,
  type CambrianToolMetadata,
  type ParamSpec,
} from './metadata.js';
import { BASE_CHAIN_ID, discoverEvmChains, projectEvmMetadata, type EvmChain } from './cli/evm-chains.js';
import { buildQueryParams, serializeQueryParams } from './cli/dynamic-handler.js';
import { CliUsageError } from './cli/core.js';

export { EVM_CHAINS, type EvmChain } from './cli/evm-chains.js';

export interface CambrianTool extends CambrianToolMetadata {
  /** Set on EVM tools: `chain_id` is pinned to this chain and hidden from the input schema. */
  chain?: EvmChain;
  /** CLI defaults the tool applies when an argument is omitted. */
  cliDefaults: Record<string, string>;
}

/** Every CLI command as a tool. EVM commands are named `cambrian_<chain>_<resource>`. */
export function listCambrianCliTools(groups: Record<CambrianGroup, CambrianMetadataGroup>): CambrianTool[] {
  const tool = (group: CambrianGroup, resource: string, metadata: CambrianMetadataGroup, chain?: EvmChain): CambrianTool => {
    const base = buildCambrianToolMetadata(group, resource, { ...groups, [group]: metadata });
    const renamed = chain && chain.chainId !== BASE_CHAIN_ID
      ? {
          name: base.name.replace(/^cambrian_base_/, `cambrian_${chain.command.replace(/-/g, '_')}_`),
          description: base.description.replace(/^Query Cambrian base /, `Query Cambrian ${chain.label} `),
        }
      : {};
    return { ...base, ...renamed, ...(chain ? { chain } : {}), cliDefaults: metadata.cliDefaults[resource] ?? {} };
  };
  return (Object.keys(groups) as CambrianGroup[]).flatMap((group) => {
    const metadata = groups[group];
    if (group !== 'base') return metadata.resources.map((resource) => tool(group, resource, metadata));
    const projections = discoverEvmChains(metadata).map((chain) => [chain, projectEvmMetadata(metadata, chain.chainId)] as const);
    return metadata.resources.flatMap((resource) => projections
      .filter(([, projected]) => resource in projected.spec)
      .map(([chain, projected]) => tool(group, resource, projected, chain)));
  });
}

export interface ToolJsonSchema {
  [key: string]: unknown;
  type: string;
  properties?: Record<string, ToolJsonSchema>;
  required?: string[];
  items?: ToolJsonSchema;
}

function itemsSchema(items: NonNullable<ParamSpec['items']>): ToolJsonSchema {
  return {
    type: items.type ?? 'string',
    ...(items.enum ? { enum: items.enum } : {}),
    ...(items.min !== undefined ? { minimum: items.min } : {}),
    ...(items.max !== undefined ? { maximum: items.max } : {}),
    ...(items.exclusiveMin !== undefined ? { exclusiveMinimum: items.exclusiveMin } : {}),
    ...(items.exclusiveMax !== undefined ? { exclusiveMaximum: items.exclusiveMax } : {}),
    ...(items.pattern ? { pattern: items.pattern } : {}),
  };
}

export function paramJsonSchema(param: ParamSpec): ToolJsonSchema {
  return {
    type: param.type || 'string',
    ...(param.description ? { description: param.description } : {}),
    ...(param.enum ? { enum: param.enum } : {}),
    ...(param.numericEnum ? { enum: param.numericEnum } : {}),
    ...(param.default !== undefined ? { default: param.default } : {}),
    ...(param.min !== undefined ? { minimum: param.min } : {}),
    ...(param.max !== undefined ? { maximum: param.max } : {}),
    ...(param.exclusiveMin !== undefined ? { exclusiveMinimum: param.exclusiveMin } : {}),
    ...(param.exclusiveMax !== undefined ? { exclusiveMaximum: param.exclusiveMax } : {}),
    ...(param.pattern ? { pattern: param.pattern } : {}),
    ...(param.type === 'array' ? { items: param.items ? itemsSchema(param.items) : { type: 'string' } } : {}),
    ...(param.minItems !== undefined ? { minItems: param.minItems } : {}),
    ...(param.maxItems !== undefined ? { maxItems: param.maxItems } : {}),
  };
}

/**
 * JSON Schema of a tool's arguments; `required` matches the CLI's required flags,
 * and a CLI default is advertised as the parameter's `default`.
 */
export function toolInputSchema(tool: CambrianTool): ToolJsonSchema {
  const params = tool.params.filter((param) => !(tool.chain && param.name === 'chain_id'));
  const required = params.filter((param) => param.required).map((param) => param.name);
  const schema = (param: CambrianTool['params'][number]): ToolJsonSchema => {
    const json = paramJsonSchema(param.spec);
    const cliDefault = tool.cliDefaults[param.name];
    if (cliDefault === undefined) return json;
    return { ...json, default: json.type === 'integer' || json.type === 'number' ? Number(cliDefault) : cliDefault };
  };
  return {
    type: 'object',
    properties: Object.fromEntries(params.map((param) => [param.name, schema(param)])),
    ...(required.length > 0 ? { required } : {}),
  };
}

export type ToolArgumentCode =
  | 'UNKNOWN_PARAMETER' | 'MISSING_REQUIRED' | 'INVALID_TYPE' | 'INVALID_ENUM' | 'BELOW_MINIMUM'
  | 'ABOVE_MAXIMUM' | 'TOO_FEW_ITEMS' | 'TOO_MANY_ITEMS' | 'PATTERN_MISMATCH' | 'INVALID_SORT';

export class ToolArgumentError extends Error {
  constructor(readonly code: ToolArgumentCode, message: string, readonly param?: string) {
    super(message);
    this.name = 'ToolArgumentError';
  }
}

// Classifies the CLI's own usage messages; tests/tools.test.ts pins one message per code.
const USAGE_CODES: Array<[RegExp, ToolArgumentCode]> = [
  [/^Missing required option/, 'MISSING_REQUIRED'],
  [/both name a column/, 'INVALID_SORT'],
  [/must be one of/, 'INVALID_ENUM'],
  [/must contain at least/, 'TOO_FEW_ITEMS'],
  [/must contain at most/, 'TOO_MANY_ITEMS'],
  [/must be (at least|greater than)/, 'BELOW_MINIMUM'],
  [/must be (at most|less than)/, 'ABOVE_MAXIMUM'],
  [/invalid format/, 'PATTERN_MISMATCH'],
];

function toToolError(error: CliUsageError, toolName: string): ToolArgumentError {
  const flag = error.message.match(/--([a-z0-9-]+)/)?.[1];
  const param = flag?.replace(/-/g, '_');
  const message = error.message
    .replace(/^Missing required option --([a-z0-9-]+)\./, (_, f: string) => `Missing required parameter "${f.replace(/-/g, '_')}" for ${toolName}.`)
    .replace(/--([a-z0-9-]+)/g, (_, f: string) => `"${f.replace(/-/g, '_')}"`)
    .replace(/^"/, 'Parameter "');
  const code = USAGE_CODES.find(([pattern]) => pattern.test(error.message))?.[1] ?? 'INVALID_TYPE';
  return new ToolArgumentError(code, message, param);
}

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/**
 * Converts JSON tool arguments into the API query the CLI would send for the
 * same flags. `null` and `undefined` mean "omitted". Throws ToolArgumentError.
 */
export function buildToolQuery(tool: CambrianTool, args: Record<string, unknown>): Record<string, unknown> {
  const options = new Map<string, string[]>();
  for (const [name, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const param = tool.params.find((candidate) => candidate.name === name);
    if (!param) throw new ToolArgumentError('UNKNOWN_PARAMETER', `Unknown parameter "${name}" for ${tool.name}.`, name);
    const values = Array.isArray(value) ? value : [value];
    if (!values.every(isScalar) || (typeof value === 'boolean' && param.spec.type !== 'boolean')) {
      const type = param.spec.type || 'string';
      throw new ToolArgumentError('INVALID_TYPE', `Parameter "${name}" must be ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}.`, name);
    }
    options.set(param.cliFlag, [values.map(String).join(',')]);
  }
  const entry = {
    apiPath: tool.apiPath,
    method: tool.method,
    params: Object.fromEntries(tool.params.map((param) => [param.name, param.spec])),
  };
  try {
    return serializeQueryParams(entry, buildQueryParams(entry, { positionals: [], options }, tool.cliDefaults));
  } catch (error) {
    throw error instanceof CliUsageError ? toToolError(error, tool.name) : error;
  }
}
