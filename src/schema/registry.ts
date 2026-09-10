import {
  CAMBRIAN_METADATA_GROUPS,
  type CambrianGroup,
  type CambrianMetadataGroup,
  type GroupSpec,
  type ParamSpec,
} from '../metadata.js';
import type { Runtime } from '../cli/core.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const SUPPORTED_PARAM_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'array']);
export const MIN_LLMS_ENDPOINTS = 5;
export const REGISTRY_CACHE_VERSION = 6;
export const REGISTRY_TTL_MS = 15 * 60 * 1000;
export const REGISTRY_FETCH_TIMEOUT_MS = 5_000;
const MAX_SCHEMA_BYTES = 5 * 1024 * 1024;
const LLMS_URL = 'https://docs.cambrian.org/llms.txt';
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const REJECTION_REASONS = new Set<RegistryRejectionReason>([
  'unsupported_method',
  'parameterized_path',
  'request_body',
  'unsupported_parameter_location',
  'unsupported_parameter_schema',
  'parameter_name_collision',
  'resource_name_collision',
  'deprecated_operation',
]);

interface OpenApiSource {
  name: string;
  url: string;
  groups: CambrianGroup[];
}

const OPENAPI_PRIMARY_SOURCES: Record<CambrianGroup, OpenApiSource> = {
  solana: {
    name: 'solana-primary',
    url: 'https://api.cambrian.org/solana/openapi.json',
    groups: ['solana'],
  },
  base: {
    name: 'base-primary',
    url: 'https://api.cambrian.org/evm/openapi.json',
    groups: ['base'],
  },
  deep42: {
    name: 'deep42-primary',
    url: 'https://api.cambrian.org/deep42/openapi.json',
    groups: ['deep42'],
  },
  risk: {
    name: 'risk-primary',
    url: 'https://api.cambrian.org/risk/openapi.json',
    groups: ['risk'],
  },
};

const OPABINIA_FALLBACK_SOURCE: OpenApiSource = {
  name: 'opabinia-fallback',
  url: 'https://opabinia.cambrian.org/openapi.json',
  groups: ['solana', 'base'],
};

function fallbackOpenApiSource(group: CambrianGroup): OpenApiSource | undefined {
  return group === 'solana' || group === 'base' ? OPABINIA_FALLBACK_SOURCE : undefined;
}

export type RegistryRejectionReason =
  | 'unsupported_method'
  | 'parameterized_path'
  | 'request_body'
  | 'unsupported_parameter_location'
  | 'unsupported_parameter_schema'
  | 'parameter_name_collision'
  | 'resource_name_collision'
  | 'deprecated_operation';

export interface RegistryRejection {
  path: string;
  method: string;
  reason: RegistryRejectionReason;
  detail?: string;
}

export interface NormalizedOpenApiGroup {
  spec: GroupSpec;
  rejected: RegistryRejection[];
}

export interface VisibilityResult {
  spec: GroupSpec;
  mode: 'llms-filtered' | 'openapi-sparse';
  usableLlmsCount: number;
}

interface SourceValidators {
  etag?: string;
  lastModified?: string;
}

interface SourceAttempt {
  version: number;
  url: string;
  lastAttemptAt: number;
  lastError?: string;
}

interface RegistryCacheEntry {
  version: number;
  group: CambrianGroup;
  fetchedAt: number;
  expiresAt: number;
  compatibleSpec: GroupSpec;
  visibleSpec: GroupSpec;
  llmsEndpointKeys: string[];
  rejected: RegistryRejection[];
  visibilityMode: VisibilityResult['mode'];
  usableLlmsCount: number;
  missingLiveAdditions: string[];
  driftedLiveAdditions: string[];
  openapiUrl: string;
  openapi: SourceValidators;
  llms: SourceValidators;
  lastAttemptAt?: number;
  lastError?: string;
  warning?: string;
}

export interface RuntimeRegistryStatus {
  group: CambrianGroup;
  source: 'bundle' | 'cache' | 'live';
  visibilityMode: VisibilityResult['mode'] | 'bundle';
  bundledCount: number;
  compatibleCount: number;
  visibleLiveCount: number;
  additions: string[];
  driftedBundled: string[];
  removedBundled: string[];
  hiddenByLlms: string[];
  missingLiveAdditions: string[];
  driftedLiveAdditions: string[];
  rejected: RegistryRejection[];
  usableLlmsCount: number;
  fetchedAt: number | null;
  expiresAt: number | null;
  lastAttemptAt: number | null;
  stale: boolean;
  cachePath: string;
  openapi: SourceValidators & {
    url: string;
    primaryUrl: string;
    fallbackUrls: string[];
  };
  llms: SourceValidators & { url: string };
  lastError?: string;
  warning?: string;
}

export interface RuntimeMetadataResolution {
  metadata: CambrianMetadataGroup;
  status: RuntimeRegistryStatus;
}

export interface RuntimeRegistryLoadOptions {
  refresh?: boolean;
  offline?: boolean;
  missingResource?: string;
  now?: number;
  timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function groupPathPrefix(group: CambrianGroup): string {
  switch (group) {
    case 'solana':
      return '/api/v1/solana/';
    case 'base':
      return '/api/v1/evm/';
    case 'deep42':
      return '/api/v1/deep42/';
    case 'risk':
      return '/api/v1/perp-risk-engine';
  }
}

function normalizeApiPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function canonicalApiPath(group: CambrianGroup, rawPath: string): string {
  const path = normalizeApiPath(rawPath);
  if (path.startsWith('/api/v1/')) return path;
  if (group === 'risk' && path === '/risk/perp-risk-engine') {
    return '/api/v1/perp-risk-engine';
  }
  return path.startsWith(`/${group === 'base' ? 'evm' : group}/`)
    ? `/api/v1${path}`
    : path;
}

function isSafeRecordKey(value: string): boolean {
  return !UNSAFE_RECORD_KEYS.has(value);
}

function resourceFromPath(group: CambrianGroup, rawPath: string): string | null {
  const path = canonicalApiPath(group, rawPath);
  const prefix = groupPathPrefix(group);
  if (group === 'risk') {
    return path === prefix ? 'perp-risk-engine' : null;
  }
  if (!path.startsWith(prefix)) return null;
  const suffix = path.slice(prefix.length);
  const segments = suffix.split('/');
  if (
    !suffix ||
    segments.some((segment) =>
      !SAFE_PATH_SEGMENT.test(segment) || !isSafeRecordKey(segment))
  ) {
    return null;
  }
  const resource = group === 'deep42' ? suffix : segments.join('-');
  return isSafeRecordKey(resource) ? resource : null;
}

function stringEnum(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((entry) => typeof entry === 'string')
  ) return null;
  return [...value];
}

function numericBounds(schema: JsonObject, type: unknown): Pick<
  ParamSpec,
  'min' | 'max' | 'exclusiveMin' | 'exclusiveMax'
> | null {
  const entries = [
    ['minimum', 'min'],
    ['maximum', 'max'],
    ['exclusiveMinimum', 'exclusiveMin'],
    ['exclusiveMaximum', 'exclusiveMax'],
  ] as const;
  const result: Pick<ParamSpec, 'min' | 'max' | 'exclusiveMin' | 'exclusiveMax'> = {};
  for (const [source, target] of entries) {
    const value = schema[source];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    result[target] = value;
  }
  if (Object.keys(result).length > 0 && type !== 'integer' && type !== 'number') return null;
  const lower = Math.max(result.min ?? -Infinity, result.exclusiveMin ?? -Infinity);
  const upper = Math.min(result.max ?? Infinity, result.exclusiveMax ?? Infinity);
  if (lower > upper) return null;
  if (lower === upper && (result.exclusiveMin === lower || result.exclusiveMax === upper)) return null;
  return result;
}

function normalizeParamSchema(parameter: JsonObject): ParamSpec | null {
  if (!isObject(parameter.schema)) return null;
  const schema = parameter.schema;
  if ('$ref' in schema || 'oneOf' in schema || 'anyOf' in schema || 'allOf' in schema) return null;
  if (parameter.required !== undefined && typeof parameter.required !== 'boolean') return null;

  const type = schema.type;
  if (typeof type !== 'string' || !SUPPORTED_PARAM_TYPES.has(type)) return null;
  if (parameter.allowReserved === true) return null;
  if (parameter.style !== undefined && parameter.style !== 'form') return null;
  if (parameter.explode !== undefined && typeof parameter.explode !== 'boolean') return null;
  const enumValues = type === 'string' ? stringEnum(schema.enum) : undefined;
  if (enumValues === null) return null;
  const numericEnum = type === 'integer' || type === 'number' ? schema.enum : undefined;
  if (numericEnum !== undefined && (
    !Array.isArray(numericEnum) ||
    numericEnum.length === 0 ||
    !numericEnum.every((entry) =>
      typeof entry === 'number' &&
      Number.isFinite(entry) &&
      (type !== 'integer' || Number.isSafeInteger(entry)))
  )) return null;
  if (schema.enum !== undefined && enumValues === undefined && numericEnum === undefined) return null;
  const bounds = numericBounds(schema, type);
  if (!bounds) return null;
  if (schema.pattern !== undefined && typeof schema.pattern !== 'string') return null;
  if (schema.pattern !== undefined && type !== 'string') return null;

  const result: ParamSpec = {
    required: parameter.required === true,
    type,
    strict: true,
    ...bounds,
  };
  if (enumValues !== undefined) result.enum = enumValues;
  if (numericEnum !== undefined) {
    if (numericEnum.length === 1) {
      result.min = numericEnum[0];
      result.max = numericEnum[0];
    } else {
      result.numericEnum = [...numericEnum];
    }
  }
  if (typeof parameter.description === 'string' && parameter.description.trim()) {
    result.description = parameter.description.trim();
  }
  if (typeof schema.pattern === 'string') {
    try {
      new RegExp(schema.pattern);
    } catch {
      return null;
    }
    result.pattern = schema.pattern;
  }

  if (type === 'array') {
    if (!isObject(schema.items)) return null;
    const itemEnum = stringEnum(schema.items.enum);
    if (itemEnum === null) return null;
    const inferredType =
      typeof schema.items.type === 'string'
        ? schema.items.type
        : itemEnum?.every((entry) => typeof entry === 'string')
          ? 'string'
          : undefined;
    if (!inferredType || !['string', 'integer', 'number', 'boolean'].includes(inferredType)) {
      return null;
    }
    if (itemEnum !== undefined && inferredType !== 'string') return null;
    const itemBounds = numericBounds(schema.items, inferredType);
    if (!itemBounds) return null;
    if (schema.items.pattern !== undefined && typeof schema.items.pattern !== 'string') return null;
    if (schema.items.pattern !== undefined && inferredType !== 'string') return null;
    if (schema.minItems !== undefined &&
      (!Number.isSafeInteger(schema.minItems) || (schema.minItems as number) < 0)) return null;
    if (schema.maxItems !== undefined &&
      (!Number.isSafeInteger(schema.maxItems) || (schema.maxItems as number) < 0)) return null;
    if (typeof schema.minItems === 'number' && typeof schema.maxItems === 'number' &&
      schema.minItems > schema.maxItems) return null;
    result.items = { type: inferredType, ...itemBounds };
    if (itemEnum !== undefined) result.items.enum = itemEnum;
    if (typeof schema.items.pattern === 'string') {
      try {
        new RegExp(schema.items.pattern);
      } catch {
        return null;
      }
      result.items.pattern = schema.items.pattern;
    }
    if (typeof schema.minItems === 'number') result.minItems = schema.minItems;
    if (typeof schema.maxItems === 'number') result.maxItems = schema.maxItems;
    result.style = 'form';
    result.explode = typeof parameter.explode === 'boolean' ? parameter.explode : true;
  }

  if (schema.default !== undefined) {
    if (!isValidDefault(schema.default, result)) return null;
    result.default = schema.default;
  }

  return result;
}

function isValidPrimitive(value: unknown, spec: ParamSpec): boolean {
  if (spec.type === 'string') {
    if (typeof value !== 'string') return false;
    if (spec.enum && !spec.enum.includes(value)) return false;
    return !spec.pattern || new RegExp(spec.pattern).test(value);
  }
  if (spec.type === 'integer') {
    if (!Number.isSafeInteger(value)) return false;
  } else if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  } else if (spec.type === 'boolean') {
    return typeof value === 'boolean';
  } else {
    return false;
  }
  const numeric = value as number;
  if (spec.numericEnum && !spec.numericEnum.includes(numeric)) return false;
  return (spec.min === undefined || numeric >= spec.min) &&
    (spec.max === undefined || numeric <= spec.max) &&
    (spec.exclusiveMin === undefined || numeric > spec.exclusiveMin) &&
    (spec.exclusiveMax === undefined || numeric < spec.exclusiveMax);
}

function isValidDefault(value: unknown, spec: ParamSpec): boolean {
  if (spec.type !== 'array') return isValidPrimitive(value, spec);
  if (!Array.isArray(value) || !spec.items) return false;
  if (spec.minItems !== undefined && value.length < spec.minItems) return false;
  if (spec.maxItems !== undefined && value.length > spec.maxItems) return false;
  return value.every((item) => isValidPrimitive(item, {
    required: true,
    type: spec.items!.type ?? 'string',
    ...(spec.items!.enum ? { enum: spec.items!.enum } : {}),
    ...(spec.items!.min !== undefined ? { min: spec.items!.min } : {}),
    ...(spec.items!.max !== undefined ? { max: spec.items!.max } : {}),
    ...(spec.items!.exclusiveMin !== undefined ? { exclusiveMin: spec.items!.exclusiveMin } : {}),
    ...(spec.items!.exclusiveMax !== undefined ? { exclusiveMax: spec.items!.exclusiveMax } : {}),
    ...(spec.items!.pattern ? { pattern: spec.items!.pattern } : {}),
  }));
}

function reject(
  rejected: RegistryRejection[],
  path: string,
  method: string,
  reason: RegistryRejectionReason,
  detail?: string,
): void {
  rejected.push({ path, method: method.toUpperCase(), reason, ...(detail ? { detail } : {}) });
}

function parameterIdentity(value: unknown): string | null {
  if (!isObject(value) || typeof value.name !== 'string' || typeof value.in !== 'string') {
    return null;
  }
  return `${value.in}\0${value.name}`;
}

/**
 * Converts one service's OpenAPI document into the deliberately small runtime
 * command profile. It never follows `servers`, references, bodies, or
 * cross-service proxy routes.
 */
export function normalizeOpenApiGroup(group: CambrianGroup, document: unknown): NormalizedOpenApiGroup {
  const spec: GroupSpec = {};
  const rejected: RegistryRejection[] = [];
  if (!isObject(document) || !isObject(document.paths)) return { spec, rejected };

  const resourcePaths = new Map<string, string>();
  for (const [rawPath, rawPathItem] of Object.entries(document.paths)) {
    if (!isObject(rawPathItem)) continue;
    const path = canonicalApiPath(group, rawPath);
    const belongsToGroup = group === 'risk'
      ? path.startsWith(`${groupPathPrefix(group)}/`)
      : path.startsWith(groupPathPrefix(group));
    if (belongsToGroup && (path.includes('{') || path.includes('}'))) {
      for (const [rawMethod, rawOperation] of Object.entries(rawPathItem)) {
        const method = rawMethod.toLowerCase();
        if (HTTP_METHODS.has(method) && isObject(rawOperation)) {
          reject(rejected, path, method, 'parameterized_path');
        }
      }
      continue;
    }
    const resource = resourceFromPath(group, rawPath);
    if (!resource) continue;

    for (const [rawMethod, rawOperation] of Object.entries(rawPathItem)) {
      const method = rawMethod.toLowerCase();
      if (!HTTP_METHODS.has(method) || !isObject(rawOperation)) continue;
      if (method !== 'get') {
        reject(rejected, path, method, 'unsupported_method');
        continue;
      }
      if (path.includes('{') || path.includes('}')) {
        reject(rejected, path, method, 'parameterized_path');
        continue;
      }
      if (rawOperation.deprecated === true) {
        reject(rejected, path, method, 'deprecated_operation');
        continue;
      }
      if (rawOperation.requestBody !== undefined) {
        reject(rejected, path, method, 'request_body');
        continue;
      }

      const inherited = Array.isArray(rawPathItem.parameters) ? rawPathItem.parameters : [];
      const own = Array.isArray(rawOperation.parameters) ? rawOperation.parameters : [];
      const ownIdentities = new Set(own.map(parameterIdentity).filter((value) => value !== null));
      const effectiveParameters = [
        ...inherited.filter((parameter) => {
          const identity = parameterIdentity(parameter);
          return identity === null || !ownIdentities.has(identity);
        }),
        ...own,
      ];
      const params: Record<string, ParamSpec> = {};
      const cliNames = new Set<string>();
      let invalid = false;

      for (const rawParameter of effectiveParameters) {
        if (!isObject(rawParameter) || typeof rawParameter.name !== 'string') {
          reject(rejected, path, method, 'unsupported_parameter_schema');
          invalid = true;
          break;
        }
        if (rawParameter.in !== 'query') {
          reject(
            rejected,
            path,
            method,
            'unsupported_parameter_location',
            typeof rawParameter.in === 'string' ? rawParameter.in : undefined,
          );
          invalid = true;
          break;
        }
        if (
          !/^[A-Za-z][A-Za-z0-9_-]*$/.test(rawParameter.name) ||
          !isSafeRecordKey(rawParameter.name)
        ) {
          reject(rejected, path, method, 'unsupported_parameter_schema', rawParameter.name);
          invalid = true;
          break;
        }
        const cliName = rawParameter.name.replace(/_/g, '-').toLowerCase();
        if (cliNames.has(cliName)) {
          reject(rejected, path, method, 'parameter_name_collision', cliName);
          invalid = true;
          break;
        }
        const normalized = normalizeParamSchema(rawParameter);
        if (!normalized) {
          reject(rejected, path, method, 'unsupported_parameter_schema', rawParameter.name);
          invalid = true;
          break;
        }
        cliNames.add(cliName);
        params[rawParameter.name] = normalized;
      }
      if (invalid) continue;

      const previousPath = resourcePaths.get(resource);
      if (previousPath && previousPath !== path) {
        delete spec[resource];
        reject(rejected, path, method, 'resource_name_collision', resource);
        continue;
      }
      resourcePaths.set(resource, path);
      spec[resource] = { apiPath: path, method: 'GET', params };
    }
  }
  return { spec, rejected };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function endpointSpecsEqual(left: GroupSpec[string], right: GroupSpec[string]): boolean {
  const executableContract = (endpoint: GroupSpec[string]): unknown => ({
    apiPath: normalizeApiPath(endpoint.apiPath),
    method: endpoint.method.toUpperCase(),
    params: Object.fromEntries(Object.entries(endpoint.params).map(([name, param]) => {
      const { description: _description, strict: _strict, ...contract } = param;
      return [name, contract];
    })),
  });
  return stableJson(executableContract(left)) === stableJson(executableContract(right));
}

function addedResources(baseline: GroupSpec, current: GroupSpec): string[] {
  return Object.keys(current).filter((resource) => !Object.hasOwn(baseline, resource));
}

function removedResources(baseline: GroupSpec, current: GroupSpec): string[] {
  return Object.keys(baseline).filter((resource) => !Object.hasOwn(current, resource));
}

function changedResources(baseline: GroupSpec, current: GroupSpec): string[] {
  return Object.entries(baseline)
    .filter(([resource, endpoint]) =>
      Object.hasOwn(current, resource) && !endpointSpecsEqual(endpoint, current[resource]))
    .map(([resource]) => resource);
}

export function endpointKey(method: string, apiPath: string): string {
  return `${method.toUpperCase()} ${normalizeApiPath(apiPath)}`;
}

function bundledEndpointKeys(group: CambrianGroup): Set<string> {
  return new Set(Object.values(CAMBRIAN_METADATA_GROUPS[group].spec).map((endpoint) =>
    endpointKey(endpoint.method, endpoint.apiPath)));
}

export function parseLlmsEndpointKeys(text: string): Set<string> {
  const keys = new Set<string>();
  const pattern = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9._~%/-]+)/g;
  for (const match of text.matchAll(pattern)) {
    let path = match[2].replace(/[),.;]+$/, '');
    if (path.startsWith('/solana/')) path = canonicalApiPath('solana', path);
    else if (path.startsWith('/evm/')) path = canonicalApiPath('base', path);
    else if (path.startsWith('/deep42/')) path = canonicalApiPath('deep42', path);
    else if (path === '/risk/perp-risk-engine') path = canonicalApiPath('risk', path);
    if (!path.includes('{') && !path.includes('}')) keys.add(endpointKey(match[1], path));
  }
  return keys;
}

/** Applies the docs threshold to the authoritative compatible OpenAPI operations. */
export function applyVisibilityPolicy(
  discovered: GroupSpec,
  llmsEndpointKeys: ReadonlySet<string>,
): VisibilityResult {
  const documentedEntries = Object.entries(discovered).filter(([, endpoint]) =>
    llmsEndpointKeys.has(endpointKey(endpoint.method, endpoint.apiPath)),
  );
  if (documentedEntries.length >= MIN_LLMS_ENDPOINTS) {
    return {
      spec: Object.fromEntries(documentedEntries),
      mode: 'llms-filtered',
      usableLlmsCount: documentedEntries.length,
    };
  }
  return {
    spec: { ...discovered },
    mode: 'openapi-sparse',
    usableLlmsCount: documentedEntries.length,
  };
}

function cacheBaseDir(runtime: Runtime): string {
  if (process.platform === 'win32') {
    const local = runtime.env.LOCALAPPDATA;
    if (local) return join(local, 'cambrian', 'cache');
  }
  const base = runtime.env.XDG_CACHE_HOME || join(runtime.homedir(), '.cache');
  return join(base, 'cambrian');
}

const sourceAttempts = new Map<string, SourceAttempt>();
interface SourceRefreshOutcome {
  entries: Map<CambrianGroup, RegistryCacheEntry>;
  fetched: boolean;
  error?: string;
  inProgress?: boolean;
}

const inFlightRefreshes = new Map<string, Promise<SourceRefreshOutcome>>();

function sourceAttemptPath(runtime: Runtime, source: OpenApiSource): string {
  return join(
    cacheBaseDir(runtime),
    `schema-v${REGISTRY_CACHE_VERSION}`,
    `${source.name}.attempt.json`,
  );
}

function sourceRegistryCachePath(
  runtime: Runtime,
  source: OpenApiSource,
  group: CambrianGroup,
): string {
  return join(
    cacheBaseDir(runtime),
    `schema-v${REGISTRY_CACHE_VERSION}`,
    'sources',
    `${source.name}.${group}.json`,
  );
}

function readSourceAttempt(runtime: Runtime, source: OpenApiSource): SourceAttempt | null {
  const path = sourceAttemptPath(runtime, source);
  const inMemory = sourceAttempts.get(path);
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isObject(parsed) ||
      parsed.version !== REGISTRY_CACHE_VERSION ||
      parsed.url !== source.url ||
      !Number.isFinite(parsed.lastAttemptAt) ||
      (parsed.lastAttemptAt as number) < 0 ||
      (parsed.lastError !== undefined && typeof parsed.lastError !== 'string')) {
      return inMemory ?? null;
    }
    const persisted = parsed as unknown as SourceAttempt;
    return !inMemory || persisted.lastAttemptAt >= inMemory.lastAttemptAt ? persisted : inMemory;
  } catch {
    return inMemory ?? null;
  }
}

function writeSourceAttempt(runtime: Runtime, source: OpenApiSource, attempt: SourceAttempt): void {
  const path = sourceAttemptPath(runtime, source);
  sourceAttempts.set(path, attempt);
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(attempt, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  } catch {
    // The in-process record still prevents a tight retry loop when the cache
    // directory is unavailable.
  }
}

function claimSourceAttempt(runtime: Runtime, source: OpenApiSource, now: number): boolean {
  const path = sourceAttemptPath(runtime, source);
  const lockPath = `${path}.lock`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(lockPath, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
    } catch {
      try {
        if (Date.now() - statSync(lockPath).mtimeMs <= REGISTRY_FETCH_TIMEOUT_MS * 2) return false;
        rmSync(lockPath, { force: true });
        writeFileSync(lockPath, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
      } catch {
        return false;
      }
    }

    try {
      const latest = readSourceAttempt(runtime, source);
      if (latest && now < latest.lastAttemptAt + REGISTRY_TTL_MS) return false;
      writeSourceAttempt(runtime, source, {
        version: REGISTRY_CACHE_VERSION,
        url: source.url,
        lastAttemptAt: now,
      });
      return true;
    } finally {
      rmSync(lockPath, { force: true });
    }
  } catch {
    const latest = readSourceAttempt(runtime, source);
    if (latest && now < latest.lastAttemptAt + REGISTRY_TTL_MS) return false;
    writeSourceAttempt(runtime, source, {
      version: REGISTRY_CACHE_VERSION,
      url: source.url,
      lastAttemptAt: now,
    });
    return true;
  }
}

export function registryCachePath(runtime: Runtime, group: CambrianGroup): string {
  return join(cacheBaseDir(runtime), `schema-v${REGISTRY_CACHE_VERSION}`, `${group}.json`);
}

function isCachedParam(value: unknown): value is ParamSpec {
  if (
    !isObject(value) ||
    typeof value.required !== 'boolean' ||
    typeof value.type !== 'string' ||
    value.strict !== true
  ) {
    return false;
  }
  if (!SUPPORTED_PARAM_TYPES.has(value.type)) return false;
  if (value.enum !== undefined && stringEnum(value.enum) === null) return false;
  if (value.enum !== undefined && value.type !== 'string') return false;
  if (value.numericEnum !== undefined && (
    (value.type !== 'integer' && value.type !== 'number') ||
    !Array.isArray(value.numericEnum) ||
    value.numericEnum.length < 2 ||
    !value.numericEnum.every((entry) =>
      typeof entry === 'number' &&
      Number.isFinite(entry) &&
      (value.type !== 'integer' || Number.isSafeInteger(entry)))
  )) return false;
  if (value.min !== undefined && (typeof value.min !== 'number' || !Number.isFinite(value.min))) return false;
  if (value.max !== undefined && (typeof value.max !== 'number' || !Number.isFinite(value.max))) return false;
  if (value.exclusiveMin !== undefined &&
    (typeof value.exclusiveMin !== 'number' || !Number.isFinite(value.exclusiveMin))) return false;
  if (value.exclusiveMax !== undefined &&
    (typeof value.exclusiveMax !== 'number' || !Number.isFinite(value.exclusiveMax))) return false;
  if ((value.min !== undefined || value.max !== undefined ||
    value.exclusiveMin !== undefined || value.exclusiveMax !== undefined) &&
    value.type !== 'integer' && value.type !== 'number') return false;
  const lower = Math.max(value.min as number ?? -Infinity, value.exclusiveMin as number ?? -Infinity);
  const upper = Math.min(value.max as number ?? Infinity, value.exclusiveMax as number ?? Infinity);
  if (lower > upper || (lower === upper && (value.exclusiveMin === lower || value.exclusiveMax === upper))) return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.pattern !== undefined) {
    if (typeof value.pattern !== 'string' || value.type !== 'string') return false;
    try {
      new RegExp(value.pattern);
    } catch {
      return false;
    }
  }
  if (value.type === 'array') {
    if (value.style !== 'form' || typeof value.explode !== 'boolean') return false;
    if (!isObject(value.items) || typeof value.items.type !== 'string') return false;
    if (!['string', 'integer', 'number', 'boolean'].includes(value.items.type)) return false;
    if (value.items.enum !== undefined && stringEnum(value.items.enum) === null) return false;
    if (value.items.enum !== undefined && value.items.type !== 'string') return false;
    if (value.items.min !== undefined &&
      (typeof value.items.min !== 'number' || !Number.isFinite(value.items.min))) return false;
    if (value.items.max !== undefined &&
      (typeof value.items.max !== 'number' || !Number.isFinite(value.items.max))) return false;
    if (value.items.exclusiveMin !== undefined &&
      (typeof value.items.exclusiveMin !== 'number' || !Number.isFinite(value.items.exclusiveMin))) return false;
    if (value.items.exclusiveMax !== undefined &&
      (typeof value.items.exclusiveMax !== 'number' || !Number.isFinite(value.items.exclusiveMax))) return false;
    if ((value.items.min !== undefined || value.items.max !== undefined ||
      value.items.exclusiveMin !== undefined || value.items.exclusiveMax !== undefined) &&
      value.items.type !== 'integer' && value.items.type !== 'number') return false;
    const itemLower = Math.max(value.items.min as number ?? -Infinity, value.items.exclusiveMin as number ?? -Infinity);
    const itemUpper = Math.min(value.items.max as number ?? Infinity, value.items.exclusiveMax as number ?? Infinity);
    if (itemLower > itemUpper ||
      (itemLower === itemUpper &&
        (value.items.exclusiveMin === itemLower || value.items.exclusiveMax === itemUpper))) return false;
    if (value.items.pattern !== undefined) {
      if (typeof value.items.pattern !== 'string' || value.items.type !== 'string') return false;
      try {
        new RegExp(value.items.pattern);
      } catch {
        return false;
      }
    }
    if (value.minItems !== undefined &&
      (!Number.isSafeInteger(value.minItems) || (value.minItems as number) < 0)) return false;
    if (value.maxItems !== undefined &&
      (!Number.isSafeInteger(value.maxItems) || (value.maxItems as number) < 0)) return false;
    if (typeof value.minItems === 'number' && typeof value.maxItems === 'number' &&
      value.minItems > value.maxItems) return false;
  } else if (
    value.items !== undefined ||
    value.style !== undefined ||
    value.explode !== undefined ||
    value.minItems !== undefined ||
    value.maxItems !== undefined
  ) {
    return false;
  }
  return value.default === undefined || isValidDefault(value.default, value as unknown as ParamSpec);
}

function isSourceValidators(value: unknown): value is SourceValidators {
  if (!isObject(value)) return false;
  return (value.etag === undefined || typeof value.etag === 'string') &&
    (value.lastModified === undefined || typeof value.lastModified === 'string');
}

function isRegistryRejection(value: unknown): value is RegistryRejection {
  if (!isObject(value)) return false;
  return typeof value.path === 'string' &&
    typeof value.method === 'string' &&
    typeof value.reason === 'string' &&
    REJECTION_REASONS.has(value.reason as RegistryRejectionReason) &&
    (value.detail === undefined || typeof value.detail === 'string');
}

function isCachedGroupSpec(group: CambrianGroup, value: unknown): value is GroupSpec {
  if (!isObject(value)) return false;
  for (const [resource, rawEndpoint] of Object.entries(value)) {
    if (!isSafeRecordKey(resource)) return false;
    if (!isObject(rawEndpoint)) return false;
    if (rawEndpoint.method !== 'GET' || typeof rawEndpoint.apiPath !== 'string') return false;
    if (resourceFromPath(group, rawEndpoint.apiPath) !== resource) return false;
    if (!isObject(rawEndpoint.params)) return false;
    if (!Object.values(rawEndpoint.params).every(isCachedParam)) return false;
  }
  return true;
}

function readRegistryCacheFile(
  path: string,
  group: CambrianGroup,
  expectedOpenApiUrl?: string,
): RegistryCacheEntry | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isObject(parsed)) return null;
    if (parsed.version !== REGISTRY_CACHE_VERSION || parsed.group !== group) return null;
    if (typeof parsed.openapiUrl !== 'string') return null;
    if (expectedOpenApiUrl && parsed.openapiUrl !== expectedOpenApiUrl) return null;
    if (!Number.isFinite(parsed.fetchedAt) || !Number.isFinite(parsed.expiresAt)) return null;
    if ((parsed.fetchedAt as number) < 0 || (parsed.expiresAt as number) < (parsed.fetchedAt as number)) return null;
    if (!isCachedGroupSpec(group, parsed.compatibleSpec)) return null;
    if (!isCachedGroupSpec(group, parsed.visibleSpec)) return null;
    if (Object.keys(parsed.compatibleSpec).length === 0 || Object.keys(parsed.visibleSpec).length === 0) return null;
    if (!Array.isArray(parsed.llmsEndpointKeys) || !parsed.llmsEndpointKeys.every((v) => typeof v === 'string')) {
      return null;
    }
    if (!Array.isArray(parsed.rejected) || !parsed.rejected.every(isRegistryRejection)) return null;
    if (parsed.visibilityMode !== 'llms-filtered' && parsed.visibilityMode !== 'openapi-sparse') {
      return null;
    }
    if (!Number.isSafeInteger(parsed.usableLlmsCount) || (parsed.usableLlmsCount as number) < 0) return null;
    if (!Array.isArray(parsed.missingLiveAdditions) ||
      !parsed.missingLiveAdditions.every((v) => typeof v === 'string')) return null;
    if (!Array.isArray(parsed.driftedLiveAdditions) ||
      !parsed.driftedLiveAdditions.every((v) => typeof v === 'string')) return null;
    if (!isSourceValidators(parsed.openapi) || !isSourceValidators(parsed.llms)) return null;
    if (parsed.lastAttemptAt !== undefined && !Number.isFinite(parsed.lastAttemptAt)) return null;
    if (parsed.lastError !== undefined && typeof parsed.lastError !== 'string') return null;
    if (parsed.warning !== undefined && typeof parsed.warning !== 'string') return null;
    return parsed as unknown as RegistryCacheEntry;
  } catch {
    return null;
  }
}

function readRegistryCache(runtime: Runtime, group: CambrianGroup): RegistryCacheEntry | null {
  return readRegistryCacheFile(registryCachePath(runtime, group), group);
}

function readSourceRegistryCache(
  runtime: Runtime,
  source: OpenApiSource,
  group: CambrianGroup,
): RegistryCacheEntry | null {
  return readRegistryCacheFile(
    sourceRegistryCachePath(runtime, source, group),
    group,
    source.url,
  );
}

function writeRegistryCacheFile(path: string, entry: RegistryCacheEntry): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Preserve the original cache-write error if cleanup is also blocked.
    }
    throw error;
  }
}

function writeRegistryCache(runtime: Runtime, entry: RegistryCacheEntry): void {
  writeRegistryCacheFile(registryCachePath(runtime, entry.group), entry);
}

function writeSourceRegistryCache(
  runtime: Runtime,
  source: OpenApiSource,
  entry: RegistryCacheEntry,
): void {
  writeRegistryCacheFile(sourceRegistryCachePath(runtime, source, entry.group), entry);
}

export function clearRegistryCache(runtime: Runtime, group?: CambrianGroup): number {
  const groups: CambrianGroup[] = group ? [group] : ['solana', 'base', 'deep42', 'risk'];
  let removed = 0;
  for (const current of groups) {
    const path = registryCachePath(runtime, current);
    let found = existsSync(path);
    rmSync(path, { force: true });
    const sources = [OPENAPI_PRIMARY_SOURCES[current], fallbackOpenApiSource(current)]
      .filter((source): source is OpenApiSource => source !== undefined);
    for (const source of sources) {
      const sourcePath = sourceRegistryCachePath(runtime, source, current);
      found ||= existsSync(sourcePath);
      rmSync(sourcePath, { force: true });
    }
    if (found) removed += 1;
  }
  return removed;
}

function parseCliDefault(raw: string, spec: ParamSpec): { valid: boolean; value?: unknown } {
  if (spec.type === 'string') {
    const value = spec.enum
      ? spec.enum.find((entry) => entry.toLowerCase() === raw.toLowerCase())
      : raw;
    return value !== undefined && isValidDefault(value, spec)
      ? { valid: true, value }
      : { valid: false };
  }
  if (spec.type === 'integer') {
    if (!/^-?\d+$/.test(raw)) return { valid: false };
    const value = Number(raw);
    return isValidDefault(value, spec) ? { valid: true, value } : { valid: false };
  }
  if (spec.type === 'number') {
    const value = Number(raw);
    return isValidDefault(value, spec) ? { valid: true, value } : { valid: false };
  }
  if (spec.type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') return { valid: false };
    const value = raw === 'true';
    return isValidDefault(value, spec) ? { valid: true, value } : { valid: false };
  }
  if (spec.type === 'array' && spec.items) {
    const values: unknown[] = [];
    const itemSpec: ParamSpec = {
      required: true,
      type: spec.items.type ?? 'string',
      ...(spec.items.enum ? { enum: spec.items.enum } : {}),
      ...(spec.items.min !== undefined ? { min: spec.items.min } : {}),
      ...(spec.items.max !== undefined ? { max: spec.items.max } : {}),
      ...(spec.items.exclusiveMin !== undefined ? { exclusiveMin: spec.items.exclusiveMin } : {}),
      ...(spec.items.exclusiveMax !== undefined ? { exclusiveMax: spec.items.exclusiveMax } : {}),
      ...(spec.items.pattern ? { pattern: spec.items.pattern } : {}),
    };
    const parts = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (parts.length === 0) return { valid: false };
    for (const part of parts) {
      const parsed = parseCliDefault(part, itemSpec);
      if (!parsed.valid) return { valid: false };
      values.push(parsed.value);
    }
    return isValidDefault(values, spec) ? { valid: true, value: values } : { valid: false };
  }
  return { valid: false };
}

function compatibleCliDefaults(
  group: CambrianGroup,
  spec: GroupSpec,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  const candidates = CAMBRIAN_METADATA_GROUPS[group].cliDefaults;
  for (const [resource, defaults] of Object.entries(candidates)) {
    const endpoint = spec[resource];
    if (!endpoint) continue;
    for (const [name, raw] of Object.entries(defaults)) {
      const parameter = endpoint.params[name];
      if (!parameter || parameter.default !== undefined) continue;
      if (!parseCliDefault(raw, parameter).valid) continue;
      (result[resource] ??= {})[name] = raw;
    }
  }
  return result;
}

function metadataFromSpec(group: CambrianGroup, spec: GroupSpec): CambrianMetadataGroup {
  const bundled = CAMBRIAN_METADATA_GROUPS[group];
  return {
    ...bundled,
    resources: Object.keys(spec),
    spec,
    // OpenAPI defaults win. Historical CLI conveniences survive only while
    // they remain valid under the active contract.
    cliDefaults: compatibleCliDefaults(group, spec),
  };
}

function validators(headers: Headers): SourceValidators {
  const etag = headers.get('etag') ?? undefined;
  const lastModified = headers.get('last-modified') ?? undefined;
  return { ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) };
}

function conditionalHeaders(source?: SourceValidators): Headers {
  const headers = new Headers();
  if (source?.etag) headers.set('If-None-Match', source.etag);
  if (source?.lastModified) headers.set('If-Modified-Since', source.lastModified);
  return headers;
}

async function readLimitedResponseText(response: Response, url: string): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SCHEMA_BYTES) {
        await reader.cancel();
        throw new Error(`${url} exceeded the ${MAX_SCHEMA_BYTES}-byte schema limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchText(
  runtime: Runtime,
  url: string,
  previous: SourceValidators | undefined,
  timeoutMs: number,
): Promise<{ notModified: boolean; text?: string; validators: SourceValidators }> {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const response = await runtime.fetch(url, {
      headers: conditionalHeaders(previous),
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 304) {
      return { notModified: true, validators: previous ?? {} };
    }
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SCHEMA_BYTES) {
      throw new Error(`${url} exceeded the ${MAX_SCHEMA_BYTES}-byte schema limit`);
    }
    const text = await readLimitedResponseText(response, url);
    return { notModified: false, text, validators: validators(response.headers) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function statusFor(
  group: CambrianGroup,
  source: RuntimeRegistryStatus['source'],
  now: number,
  cache: RegistryCacheEntry | null,
  lastError?: string,
): RuntimeMetadataResolution {
  const bundled = CAMBRIAN_METADATA_GROUPS[group];
  const primary = OPENAPI_PRIMARY_SOURCES[group];
  const fallback = fallbackOpenApiSource(group);
  const activeSpec = cache?.visibleSpec ?? bundled.spec;
  const metadata = cache ? metadataFromSpec(group, activeSpec) : bundled;
  return {
    metadata,
    status: {
      group,
      source,
      visibilityMode: cache?.visibilityMode ?? 'bundle',
      bundledCount: bundled.resources.length,
      compatibleCount: cache ? Object.keys(cache.compatibleSpec).length : bundled.resources.length,
      visibleLiveCount: cache ? Object.keys(cache.visibleSpec).length : bundled.resources.length,
      additions: cache ? addedResources(bundled.spec, activeSpec) : [],
      driftedBundled: cache ? changedResources(bundled.spec, cache.compatibleSpec) : [],
      removedBundled: cache ? removedResources(bundled.spec, cache.compatibleSpec) : [],
      hiddenByLlms: cache ? removedResources(cache.compatibleSpec, cache.visibleSpec) : [],
      missingLiveAdditions: cache?.missingLiveAdditions ?? [],
      driftedLiveAdditions: cache?.driftedLiveAdditions ?? [],
      rejected: cache?.rejected ?? [],
      usableLlmsCount: cache?.usableLlmsCount ?? 0,
      fetchedAt: cache?.fetchedAt ?? null,
      expiresAt: cache?.expiresAt ?? null,
      lastAttemptAt: cache?.lastAttemptAt ?? null,
      stale: cache ? now >= cache.expiresAt : true,
      cachePath: '',
      openapi: {
        url: cache?.openapiUrl ?? primary.url,
        primaryUrl: primary.url,
        fallbackUrls: fallback ? [fallback.url] : [],
        ...(cache?.openapi ?? {}),
      },
      llms: { url: LLMS_URL, ...(cache?.llms ?? {}) },
      ...(lastError ? { lastError } : {}),
      ...(!lastError && cache?.lastError ? { lastError: cache.lastError } : {}),
      ...(cache?.warning ? { warning: cache.warning } : {}),
    },
  };
}

function withActualCachePath(
  runtime: Runtime,
  resolution: RuntimeMetadataResolution,
): RuntimeMetadataResolution {
  resolution.status.cachePath = registryCachePath(runtime, resolution.status.group);
  return resolution;
}

function sourceCacheEntries(
  runtime: Runtime,
  source: OpenApiSource,
): Map<CambrianGroup, RegistryCacheEntry> {
  return new Map(source.groups.flatMap((group) => {
    const entry = readSourceRegistryCache(runtime, source, group);
    return entry ? [[group, entry] as const] : [];
  }));
}

async function refreshOpenApiSource(
  group: CambrianGroup,
  source: OpenApiSource,
  runtime: Runtime,
  now: number,
  timeoutMs: number,
): Promise<Map<CambrianGroup, RegistryCacheEntry>> {
  const caches = sourceCacheEntries(runtime, source);
  const requestedCache = caches.get(group) ?? null;
  const validatorCache = requestedCache ?? [...caches.values()][0] ?? null;
  const openapiResponse = await fetchText(runtime, source.url, requestedCache?.openapi, timeoutMs);

  const normalizedGroups = new Map<CambrianGroup, NormalizedOpenApiGroup>();
  if (openapiResponse.notModified) {
    if (!requestedCache) throw new Error(`${source.url} returned 304 without a cached registry`);
    for (const current of source.groups) {
      const currentCache = caches.get(current);
      if (currentCache) {
        normalizedGroups.set(current, {
          spec: currentCache.compatibleSpec,
          rejected: currentCache.rejected,
        });
      }
    }
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(openapiResponse.text ?? '');
    } catch {
      throw new Error(`${source.url} returned invalid JSON`);
    }
    if (!isObject(parsed) || typeof parsed.openapi !== 'string' || !parsed.openapi.startsWith('3.') ||
      !isObject(parsed.info) || typeof parsed.info.title !== 'string' ||
      typeof parsed.info.version !== 'string' || !isObject(parsed.paths)) {
      throw new Error(`${source.url} did not return an OpenAPI 3 document`);
    }
    for (const current of source.groups) {
      const normalized = normalizeOpenApiGroup(current, parsed);
      if (Object.keys(normalized.spec).length > 0) normalizedGroups.set(current, normalized);
    }
  }
  if (normalizedGroups.size === 0) {
    throw new Error(`No compatible ${group} operations from ${source.url}`);
  }

  const llmsOutcome = await fetchText(runtime, LLMS_URL, validatorCache?.llms, timeoutMs)
    .then((response) => ({ response }))
    .catch((error: unknown) => ({ error }));

  let llmsEndpointKeys: Set<string>;
  let llmsValidators: SourceValidators;
  let warning: string | undefined;
  if ('error' in llmsOutcome) {
    llmsEndpointKeys = validatorCache
      ? new Set(validatorCache.llmsEndpointKeys)
      : new Set(source.groups.flatMap((current) => [...bundledEndpointKeys(current)]));
    llmsValidators = validatorCache?.llms ?? {};
    warning = `llms.txt refresh failed: ${errorMessage(llmsOutcome.error)}; ` +
      (validatorCache ? 'using cached endpoint inventory' : 'using bundled public endpoint inventory');
  } else if (llmsOutcome.response.notModified) {
    if (validatorCache) {
      llmsEndpointKeys = new Set(validatorCache.llmsEndpointKeys);
      llmsValidators = validatorCache.llms;
    } else {
      llmsEndpointKeys = new Set(source.groups.flatMap((current) => [...bundledEndpointKeys(current)]));
      llmsValidators = {};
      warning = 'llms.txt returned 304 without a cache; using bundled public endpoint inventory';
    }
  } else {
    llmsEndpointKeys = parseLlmsEndpointKeys(llmsOutcome.response.text ?? '');
    llmsValidators = llmsOutcome.response.validators;
  }

  const entries = new Map<CambrianGroup, RegistryCacheEntry>();
  for (const [current, normalized] of normalizedGroups) {
    const currentCache = caches.get(current);
    const visibility = applyVisibilityPolicy(normalized.spec, llmsEndpointKeys);
    const previousVisibleSpec = currentCache?.visibleSpec ?? CAMBRIAN_METADATA_GROUPS[current].spec;
    const visibleSpec = { ...visibility.spec };
    const previousAdditions = new Set(addedResources(
      CAMBRIAN_METADATA_GROUPS[current].spec,
      previousVisibleSpec,
    ));
    const entry: RegistryCacheEntry = {
      version: REGISTRY_CACHE_VERSION,
      group: current,
      fetchedAt: now,
      expiresAt: now + REGISTRY_TTL_MS,
      compatibleSpec: normalized.spec,
      visibleSpec,
      llmsEndpointKeys: [...llmsEndpointKeys],
      rejected: normalized.rejected,
      visibilityMode: visibility.mode,
      usableLlmsCount: visibility.usableLlmsCount,
      missingLiveAdditions: removedResources(previousVisibleSpec, visibleSpec)
        .filter((resource) => previousAdditions.has(resource)),
      driftedLiveAdditions: changedResources(previousVisibleSpec, visibleSpec)
        .filter((resource) => previousAdditions.has(resource)),
      openapiUrl: source.url,
      openapi: openapiResponse.validators,
      llms: llmsValidators,
      lastAttemptAt: now,
      ...(warning ? { warning } : {}),
    };
    try {
      writeSourceRegistryCache(runtime, source, entry);
    } catch (error) {
      const cacheWarning = `could not persist registry cache: ${errorMessage(error)}`;
      entry.warning = warning ? `${warning}; ${cacheWarning}` : cacheWarning;
    }
    entries.set(current, entry);
  }
  return entries;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function appendWarning(current: string | undefined, warning: string): string {
  return current ? `${current}; ${warning}` : warning;
}

async function attemptOpenApiSource(
  group: CambrianGroup,
  source: OpenApiSource,
  runtime: Runtime,
  now: number,
  timeoutMs: number,
): Promise<SourceRefreshOutcome> {
  const refreshKey = sourceAttemptPath(runtime, source);
  const inFlight = inFlightRefreshes.get(refreshKey);
  if (inFlight) return inFlight;

  const cachedEntries = sourceCacheEntries(runtime, source);
  const attempt = readSourceAttempt(runtime, source);
  if (attempt && now < attempt.lastAttemptAt + REGISTRY_TTL_MS) {
    return {
      entries: cachedEntries,
      fetched: false,
      ...(attempt.lastError ? { error: attempt.lastError } : {}),
      ...(!attempt.lastError && cachedEntries.size === 0 ? { inProgress: true } : {}),
    };
  }

  if (!claimSourceAttempt(runtime, source, now)) {
    const claimedInFlight = inFlightRefreshes.get(refreshKey);
    if (claimedInFlight) return claimedInFlight;
    const claimedAttempt = readSourceAttempt(runtime, source);
    const entries = sourceCacheEntries(runtime, source);
    return {
      entries,
      fetched: false,
      ...(claimedAttempt?.lastError ? { error: claimedAttempt.lastError } : {}),
      ...(!claimedAttempt?.lastError && entries.size === 0 ? { inProgress: true } : {}),
    };
  }

  const refresh = (async (): Promise<SourceRefreshOutcome> => {
    try {
      const entries = await refreshOpenApiSource(group, source, runtime, now, timeoutMs);
      writeSourceAttempt(runtime, source, {
        version: REGISTRY_CACHE_VERSION,
        url: source.url,
        lastAttemptAt: now,
      });
      return { entries, fetched: true };
    } catch (error) {
      const message = errorMessage(error);
      writeSourceAttempt(runtime, source, {
        version: REGISTRY_CACHE_VERSION,
        url: source.url,
        lastAttemptAt: now,
        lastError: message,
      });
      return {
        entries: sourceCacheEntries(runtime, source),
        fetched: false,
        error: message,
      };
    }
  })();
  inFlightRefreshes.set(refreshKey, refresh);
  try {
    return await refresh;
  } finally {
    if (inFlightRefreshes.get(refreshKey) === refresh) inFlightRefreshes.delete(refreshKey);
  }
}

function cacheWithoutLastError(entry: RegistryCacheEntry): RegistryCacheEntry {
  const { lastError: _lastError, ...cache } = entry;
  return cache;
}

function withFallbackWarning(
  entry: RegistryCacheEntry,
  primaryError: string,
  fallbackUrl: string,
): RegistryCacheEntry {
  const cache = cacheWithoutLastError(entry);
  return {
    ...cache,
    warning: appendWarning(cache.warning, `${primaryError}; using fallback ${fallbackUrl}`),
  };
}

function activateResolution(
  runtime: Runtime,
  group: CambrianGroup,
  entry: RegistryCacheEntry,
  source: RuntimeRegistryStatus['source'],
  now: number,
): RuntimeMetadataResolution {
  let active = cacheWithoutLastError(entry);
  try {
    writeRegistryCache(runtime, active);
  } catch (error) {
    active = {
      ...active,
      warning: appendWarning(
        active.warning,
        `could not persist registry cache: ${errorMessage(error)}`,
      ),
    };
  }
  return withActualCachePath(runtime, statusFor(group, source, now, active));
}

function failedResolution(
  runtime: Runtime,
  group: CambrianGroup,
  cache: RegistryCacheEntry | null | undefined,
  now: number,
  message: string,
): RuntimeMetadataResolution {
  let failedCache = cache ? { ...cache, lastAttemptAt: now, lastError: message } : null;
  if (failedCache) {
    try {
      writeRegistryCache(runtime, failedCache);
    } catch (error) {
      failedCache = {
        ...failedCache,
        warning: appendWarning(
          failedCache.warning,
          `could not persist registry cache: ${errorMessage(error)}`,
        ),
      };
    }
  }
  return withActualCachePath(
    runtime,
    statusFor(group, failedCache ? 'cache' : 'bundle', now, failedCache, message),
  );
}

function newestCache(
  ...entries: Array<RegistryCacheEntry | null | undefined>
): RegistryCacheEntry | null {
  return entries.reduce<RegistryCacheEntry | null>(
    (best, entry) => entry && (!best || entry.fetchedAt > best.fetchedAt) ? entry : best,
    null,
  );
}

/**
 * Loads validated authoritative runtime metadata. Refresh failures fall back
 * to the last-known-good cache and then the immutable bundled snapshot.
 */
export async function loadRuntimeMetadataGroup(
  group: CambrianGroup,
  runtime: Runtime,
  options: RuntimeRegistryLoadOptions = {},
): Promise<RuntimeMetadataResolution> {
  const now = options.now ?? Date.now();
  const mode = runtime.env.CAMBRIAN_SCHEMA_MODE?.trim().toLowerCase();
  if (mode === 'bundled') {
    return withActualCachePath(runtime, statusFor(group, 'bundle', now, null));
  }

  const primary = OPENAPI_PRIMARY_SOURCES[group];
  const fallback = fallbackOpenApiSource(group);
  const activeCache = readRegistryCache(runtime, group);
  const primaryCache = readSourceRegistryCache(runtime, primary, group);
  const fallbackCache = fallback ? readSourceRegistryCache(runtime, fallback, group) : null;
  const cached = activeCache ?? primaryCache ?? fallbackCache;
  if (options.offline) {
    return withActualCachePath(runtime, statusFor(group, cached ? 'cache' : 'bundle', now, cached));
  }

  const primaryAttempt = readSourceAttempt(runtime, primary);
  const primaryCoolingDown = primaryAttempt !== null &&
    now < primaryAttempt.lastAttemptAt + REGISTRY_TTL_MS;
  if (activeCache && now < activeCache.expiresAt && (
    activeCache.openapiUrl === primary.url || primaryCoolingDown
  )) {
    return withActualCachePath(runtime, statusFor(group, 'cache', now, activeCache));
  }
  if (primaryCache && now < primaryCache.expiresAt) {
    return activateResolution(runtime, group, primaryCache, 'cache', now);
  }

  const timeoutMs = options.timeoutMs ?? REGISTRY_FETCH_TIMEOUT_MS;
  const primaryOutcome = await attemptOpenApiSource(group, primary, runtime, now, timeoutMs);
  const refreshedPrimary = primaryOutcome.entries.get(group);
  if (refreshedPrimary && !primaryOutcome.error) {
    return activateResolution(
      runtime,
      group,
      refreshedPrimary,
      primaryOutcome.fetched ? 'live' : 'cache',
      now,
    );
  }
  if (primaryOutcome.inProgress) {
    return withActualCachePath(runtime, statusFor(group, cached ? 'cache' : 'bundle', now, cached));
  }
  const primaryError = primaryOutcome.error ??
    `No compatible ${group} operations from ${primary.url}`;

  if (fallback) {
    const currentFallback = primaryOutcome.fetched
      ? readSourceRegistryCache(runtime, fallback, group) ?? fallbackCache
      : fallbackCache;
    if (currentFallback && now < currentFallback.expiresAt) {
      return activateResolution(
        runtime,
        group,
        withFallbackWarning(currentFallback, primaryError, fallback.url),
        'cache',
        now,
      );
    }

    const fallbackOutcome = await attemptOpenApiSource(group, fallback, runtime, now, timeoutMs);
    const refreshedFallback = fallbackOutcome.entries.get(group);
    if (refreshedFallback && !fallbackOutcome.error) {
      return activateResolution(
        runtime,
        group,
        withFallbackWarning(refreshedFallback, primaryError, fallback.url),
        fallbackOutcome.fetched ? 'live' : 'cache',
        now,
      );
    }
    const fallbackError = fallbackOutcome.error ??
      `No compatible ${group} operations from ${fallback.url}`;
    const message = `${primaryError}; fallback failed: ${fallbackError}`;
    const lastKnownGood = newestCache(
      refreshedPrimary,
      primaryCache,
      activeCache,
      refreshedFallback,
      fallbackCache,
    );
    return failedResolution(runtime, group, lastKnownGood, now, message);
  }

  return failedResolution(runtime, group, refreshedPrimary ?? primaryCache ?? activeCache, now, primaryError);
}

/** Synchronous cache-only resolver for shell completion. */
export function loadCachedMetadataGroup(
  group: CambrianGroup,
  runtime: Runtime,
  now = Date.now(),
): RuntimeMetadataResolution {
  if (runtime.env.CAMBRIAN_SCHEMA_MODE?.trim().toLowerCase() === 'bundled') {
    return withActualCachePath(runtime, statusFor(group, 'bundle', now, null));
  }
  const primary = OPENAPI_PRIMARY_SOURCES[group];
  const fallback = fallbackOpenApiSource(group);
  const cache = readRegistryCache(runtime, group) ??
    readSourceRegistryCache(runtime, primary, group) ??
    (fallback ? readSourceRegistryCache(runtime, fallback, group) : null);
  return withActualCachePath(runtime, statusFor(group, cache ? 'cache' : 'bundle', now, cache));
}
