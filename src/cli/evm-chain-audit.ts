/**
 * Deterministic EVM chain-support auditing.
 *
 * The CLI's EVM command surface is derived entirely from the chain_id enum
 * exposed by each operation in the Cambrian EVM OpenAPI document. This module
 * extracts those allow-lists from either the raw OpenAPI document or the
 * normalized registry snapshot, and compares them against the static chain
 * registry in evm-chains.ts.
 *
 * Used by:
 *   - scripts/check-evm-chains.mjs (live/offline drift check)
 *   - tests/evm-chain-audit.test.ts (offline fixture tests)
 *   - the add-evm-chain skill (agent workflow)
 */

import { EVM_CHAINS, type EvmChain } from './evm-chains.js';

interface OpenApiParameter {
  name?: unknown;
  in?: unknown;
  schema?: {
    type?: unknown;
    enum?: unknown;
    minimum?: unknown;
    maximum?: unknown;
  };
}

interface OpenApiOperation {
  parameters?: unknown;
}

interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation> | undefined>;
}

interface NormalizedParam {
  numericEnum?: unknown;
  min?: unknown;
  max?: unknown;
}

interface NormalizedEndpoint {
  params?: Record<string, NormalizedParam>;
}

interface NormalizedDocument {
  evm?: Record<string, NormalizedEndpoint>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extracts the numeric chain_id allow-list for one operation, if present. */
function operationChainIds(operation: OpenApiOperation): number[] | undefined {
  if (!Array.isArray(operation.parameters)) return undefined;
  for (const raw of operation.parameters as OpenApiParameter[]) {
    if (!isRecord(raw)) continue;
    if (raw.name !== 'chain_id' || raw.in !== 'query') continue;
    const schema = raw.schema;
    if (!isRecord(schema)) return undefined;
    if (Array.isArray(schema.enum) && schema.enum.every((v) => typeof v === 'number')) {
      return [...(schema.enum as number[])].sort((a, b) => a - b);
    }
    if (typeof schema.minimum === 'number' && schema.minimum === schema.maximum) {
      return [schema.minimum];
    }
    return undefined;
  }
  return undefined;
}

/**
 * Reads every endpoint's chain_id allow-list from a raw OpenAPI 3 document.
 * Returns a map of API path to sorted chain ids. Paths without a chain_id
 * parameter (chain-neutral discovery endpoints) are omitted.
 */
export function openApiChainSupport(document: unknown): Map<string, number[]> {
  const result = new Map<string, number[]>();
  if (!isRecord(document)) return result;
  const { paths } = document as OpenApiDocument;
  if (!isRecord(paths)) return result;

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = pathItem[method];
      if (!isRecord(operation)) continue;
      const chainIds = operationChainIds(operation as OpenApiOperation);
      if (chainIds && chainIds.length > 0) {
        result.set(path, chainIds);
        break;
      }
    }
  }
  return result;
}

/**
 * Reads chain_id allow-lists from the CLI's normalized registry format
 * (src/generated/openapi-params.json). Returns a map of resource name to sorted
 * chain ids, mirroring openApiChainSupport.
 */
export function normalizedChainSupport(spec: unknown): Map<string, number[]> {
  const result = new Map<string, number[]>();
  if (!isRecord(spec)) return result;
  const { evm } = spec as NormalizedDocument;
  if (!isRecord(evm)) return result;

  for (const [resource, endpoint] of Object.entries(evm)) {
    if (!isRecord(endpoint)) continue;
    const params = (endpoint as NormalizedEndpoint).params;
    if (!isRecord(params)) continue;
    const chain = params.chain_id;
    if (!isRecord(chain)) continue;
    if (Array.isArray(chain.numericEnum) && chain.numericEnum.every((v) => typeof v === 'number')) {
      result.set(resource, [...(chain.numericEnum as number[])].sort((a, b) => a - b));
      continue;
    }
    if (typeof chain.min === 'number' && chain.min === chain.max) {
      result.set(resource, [chain.min]);
    }
  }
  return result;
}

export interface EvmChainAuditEntry {
  chain: EvmChain;
  /** Number of operations/resources that explicitly allow this chain id. */
  endpoints: number;
  /** A few example paths/resources, for human-readable reports. */
  samplePaths: string[];
}

export interface EvmChainAudit {
  /** Every chain id that appears in any chain_id allow-list. */
  discoveredChainIds: number[];
  /** Chain ids from the static registry. */
  registryChainIds: number[];
  /** Discovered ids with no registry row - these need a new table entry. */
  unregisteredChainIds: number[];
  /** Registry chains the document does not advertise at all. */
  unsupportedChains: EvmChain[];
  /** Per-registry-chain counts. */
  perChain: EvmChainAuditEntry[];
}

/**
 * Shared audit kernel over an already-extracted path/resource allow-list map.
 * unregisteredChainIds non-empty means the CLI is missing a chain the API
 * already serves; unsupportedChains non-empty means the registry advertises
 * a chain the supplied document does not (usually a stale document).
 */
export function auditEvmChainSupport(
  support: Map<string, number[]>,
  chains: readonly EvmChain[] = EVM_CHAINS,
): EvmChainAudit {
  const discovered = new Set<number>();
  for (const ids of support.values()) for (const id of ids) discovered.add(id);

  const perChain: EvmChainAuditEntry[] = chains.map((chain) => {
    const matching = [...support.entries()].filter(([, ids]) => ids.includes(chain.chainId));
    return {
      chain,
      endpoints: matching.length,
      samplePaths: matching.slice(0, 5).map(([path]) => path),
    };
  });

  const registryIds = chains.map((chain) => chain.chainId);
  return {
    discoveredChainIds: [...discovered].sort((a, b) => a - b),
    registryChainIds: registryIds,
    unregisteredChainIds: [...discovered]
      .filter((id) => !registryIds.includes(id))
      .sort((a, b) => a - b),
    unsupportedChains: perChain.filter((entry) => entry.endpoints === 0).map((entry) => entry.chain),
    perChain,
  };
}

/** Audits a raw OpenAPI 3 EVM document against the chain registry. */
export function auditEvmChains(
  document: unknown,
  chains: readonly EvmChain[] = EVM_CHAINS,
): EvmChainAudit {
  return auditEvmChainSupport(openApiChainSupport(document), chains);
}

/** Audits the normalized registry snapshot (offline) against the chain registry. */
export function auditNormalizedEvmChains(
  spec: unknown,
  chains: readonly EvmChain[] = EVM_CHAINS,
): EvmChainAudit {
  return auditEvmChainSupport(normalizedChainSupport(spec), chains);
}
