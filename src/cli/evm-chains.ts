import type { CambrianMetadataGroup, EndpointSpec, ParamSpec } from '../metadata.js';

/**
 * Curated EVM chains: pinned command tokens and labels.
 *
 * A chain needs no row to be usable. Any chain id in the live OpenAPI
 * `chain_id` enums is served under its API name or as `chain-<id>` (see
 * discoverEvmChains). Add a row only to pin a token or label that differs from
 * the API name (see the `add-evm-chain` skill). Everything downstream —
 * command dispatch, help, completion, OpenCLI, docs fallback, schema groups,
 * and the x402 pay command — derives from this table plus discovery.
 *
 * A chain is only *advertised* when the active OpenAPI schema actually exposes
 * at least one visible operation for its id, so a stale or partial schema can
 * never produce a broken command group.
 */
export interface EvmChain {
  /** CLI command group token, e.g. `arbitrum`. */
  command: string;
  /** EVM chain id, e.g. 42161. */
  chainId: number;
  /** Human-facing chain name used in help/OpenCLI text. */
  label: string;
  /** Metadata group (always `base` today — the single EVM spec). */
  group: 'base';
}

export const BASE_CHAIN: EvmChain = {
  command: 'base',
  chainId: 8453,
  label: 'Base',
  group: 'base',
};

export const ETHEREUM_CHAIN: EvmChain = {
  command: 'ethereum',
  chainId: 1,
  label: 'Ethereum mainnet',
  group: 'base',
};

export const ARBITRUM_CHAIN: EvmChain = {
  command: 'arbitrum',
  chainId: 42161,
  label: 'Arbitrum One',
  group: 'base',
};

export const ROBINHOOD_CHAIN: EvmChain = {
  command: 'robinhood',
  chainId: 4663,
  label: 'Robinhood Chain',
  group: 'base',
};

/** Ordered list of every EVM chain command. Base must come first. */
export const EVM_CHAINS: readonly EvmChain[] = [BASE_CHAIN, ETHEREUM_CHAIN, ARBITRUM_CHAIN, ROBINHOOD_CHAIN];

/** The chain that owns chain-neutral (no `chain_id`) operations. */
export const DEFAULT_EVM_CHAIN = BASE_CHAIN;

export const BASE_CHAIN_ID = BASE_CHAIN.chainId;
export const ETHEREUM_CHAIN_ID = ETHEREUM_CHAIN.chainId;
export const ARBITRUM_CHAIN_ID = ARBITRUM_CHAIN.chainId;
export const ROBINHOOD_CHAIN_ID = ROBINHOOD_CHAIN.chainId;

/** Every CLI token that resolves to the shared EVM metadata group. */
export const EVM_GROUP_TOKENS: readonly string[] = [
  'evm',
  ...EVM_CHAINS.map((chain) => chain.command),
];

const EVM_CHAIN_BY_TOKEN = new Map(EVM_CHAINS.map((chain) => [chain.command, chain]));

/**
 * Prefix for runtime-discovered chains that have no curated name yet.
 * The active OpenAPI advertises chain ids only, so any chain id the schema
 * serves but the table does not name is exposed as `chain-<id>`. This keeps
 * OpenAPI the source of truth: a newly deployed chain is usable without a CLI
 * upgrade. A later release can promote it to a friendly command token.
 */
export const SYNTHETIC_CHAIN_PREFIX = 'chain-';

/** Parses a `chain-<id>` token into its chain id, or undefined. */
export function syntheticEvmChainId(token: string): number | undefined {
  if (!token.startsWith(SYNTHETIC_CHAIN_PREFIX)) return undefined;
  const raw = token.slice(SYNTHETIC_CHAIN_PREFIX.length);
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const id = Number.parseInt(raw, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Builds a runtime chain descriptor for a chain id with no curated row. */
export function syntheticEvmChain(chainId: number): EvmChain {
  return {
    command: `${SYNTHETIC_CHAIN_PREFIX}${chainId}`,
    chainId,
    label: `Chain ${chainId}`,
    group: 'base',
  };
}

/** True when the token is a runtime-discovered `chain-<id>` command. */
export function isSyntheticEvmChainToken(token: string): boolean {
  return syntheticEvmChainId(token) !== undefined;
}

/**
 * Resolves a CLI group token (`base`, `ethereum`, `evm`, `chain-<id>`, or an
 * API-named chain) to its chain. Pass the active EVM metadata to resolve chains
 * that only the API names; without it, only curated and `chain-<id>` tokens resolve.
 */
export function evmChainForToken(
  token: string,
  metadata?: CambrianMetadataGroup,
): EvmChain | undefined {
  if (token === 'evm') return DEFAULT_EVM_CHAIN;
  const known = EVM_CHAIN_BY_TOKEN.get(token);
  if (known) return known;
  const syntheticId = syntheticEvmChainId(token);
  if (syntheticId !== undefined) {
    const curated = EVM_CHAINS.find((chain) => chain.chainId === syntheticId);
    if (curated) return curated;
    const discovered = metadata && discoverEvmChains(metadata).find((chain) => chain.chainId === syntheticId);
    return discovered ?? syntheticEvmChain(syntheticId);
  }
  return metadata ? discoverEvmChains(metadata).find((chain) => chain.command === token) : undefined;
}

/** Resolves a CLI group token to a chain id, or undefined when it is not EVM. */
export function evmChainIdForToken(token: string, metadata?: CambrianMetadataGroup): number | undefined {
  return evmChainForToken(token, metadata)?.chainId;
}

/** Top-level commands an API chain name can never take. */
export const RESERVED_COMMAND_TOKENS: ReadonlySet<string> = new Set([
  'solana', 'evm', 'deep42', 'risk', 'pay', 'docs', 'config', 'completion',
  'schema', 'skill', 'mcp', 'describe', 'help', 'version',
]);

/** Ids allowed by a `chain_id` param: the enum, or the single pinned value. */
function chainIdValues(param: ParamSpec | undefined): number[] {
  if (!param) return [];
  if (param.numericEnum) return param.numericEnum;
  return typeof param.min === 'number' && param.min === param.max ? [param.min] : [];
}

/**
 * Chain names the API supplies, by chain id. OpenAPI `x-enum-varnames` on
 * `chain_id` wins over the cached `/evm/chains` response.
 */
export function apiEvmChainNames(metadata: CambrianMetadataGroup): Map<number, string> {
  const names = new Map<number, string>();
  for (const [id, name] of Object.entries(metadata.chainNames ?? {})) names.set(Number(id), name);
  for (const endpoint of Object.values(metadata.spec)) {
    const param = endpoint.params.chain_id;
    const ids = chainIdValues(param);
    param?.enumNames?.forEach((name, index) => {
      if (ids[index] !== undefined) names.set(ids[index], name);
    });
  }
  return names;
}

/** Turns an API chain name into a command token, e.g. `Arbitrum One` → `arbitrum-one`. */
function chainCommandToken(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Builds a descriptor for an API-named chain, or undefined if the name is unusable. */
function namedEvmChain(chainId: number, name: string, taken: ReadonlySet<string>): EvmChain | undefined {
  const command = chainCommandToken(name);
  if (
    !/^[a-z][a-z0-9-]{0,31}$/.test(command) ||
    command.startsWith(SYNTHETIC_CHAIN_PREFIX) ||
    RESERVED_COMMAND_TOKENS.has(command) ||
    taken.has(command)
  ) return undefined;
  // Labels come from the network, so keep printable ASCII only.
  const raw = name.trim().replace(/[^\x20-\x7E]/g, '').slice(0, 40);
  const label = /[A-Z ]/.test(raw) ? raw : raw.charAt(0).toUpperCase() + raw.slice(1);
  return { command, chainId, label, group: 'base' };
}

/** True when an active schema advertises at least one operation for `chain`. */
export function hasEvmChainSupport(metadata: CambrianMetadataGroup, chain: EvmChain): boolean {
  return projectEvmMetadata(metadata, chain.chainId).resources.length > 0;
}

/** Every EVM chain the active schema advertises, Base first. */
export function supportedEvmChains(metadata: CambrianMetadataGroup): EvmChain[] {
  return EVM_CHAINS.filter((chain) => hasEvmChainSupport(metadata, chain));
}

/** Chain ids the active schema advertises, Base first. */
export function supportedEvmChainIds(metadata: CambrianMetadataGroup): number[] {
  return supportedEvmChains(metadata).map((chain) => chain.chainId);
}

/** Every chain id that appears in any endpoint's chain_id allow-list. */
export function advertisedEvmChainIds(metadata: CambrianMetadataGroup): number[] {
  const ids = new Set<number>();
  for (const endpoint of Object.values(metadata.spec)) {
    const chain = endpoint.params.chain_id;
    if (!chain) continue;
    for (const id of chainIdValues(chain)) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Every EVM chain command the active schema advertises: curated chains that
 * have support, then every other advertised id. Those take their API name
 * (see apiEvmChainNames) when it is a safe, free token, else `chain-<id>`.
 * This is what dispatch, help, completion, OpenCLI, docs, and `cambrian pay`
 * enumerate, so new chains appear without a CLI upgrade. `chain-<id>` always
 * stays a valid alias.
 */
export function discoverEvmChains(metadata: CambrianMetadataGroup): EvmChain[] {
  const curated = supportedEvmChains(metadata);
  const named = new Set(curated.map((chain) => chain.chainId));
  // Curated tokens stay reserved even when their chain is not served right now.
  const taken = new Set(EVM_CHAINS.map((chain) => chain.command));
  const names = apiEvmChainNames(metadata);
  const extras = advertisedEvmChainIds(metadata)
    .filter((id) => !named.has(id))
    .map((id) => {
      const name = names.get(id);
      const chain = name === undefined ? undefined : namedEvmChain(id, name, taken);
      if (chain) taken.add(chain.command);
      return chain ?? syntheticEvmChain(id);
    });
  return [...curated, ...extras];
}

/** Advertised chain ids that have neither a curated row nor an API name. */
export function unnamedEvmChainIds(metadata: CambrianMetadataGroup): number[] {
  const curated = new Set(EVM_CHAINS.map((chain) => chain.chainId));
  const names = apiEvmChainNames(metadata);
  return advertisedEvmChainIds(metadata).filter((id) => !curated.has(id) && !names.has(id));
}

/** Other chains (not `chain`) whose projection serves `resource`. */
export function otherEvmChainsFor(
  metadata: CambrianMetadataGroup,
  chain: EvmChain,
  resource: string,
): EvmChain[] {
  return discoverEvmChains(metadata).filter((other) =>
    other.chainId !== chain.chainId && projectEvmMetadata(metadata, other.chainId).spec[resource]);
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * A default address in the shared EVM schema belongs to the schema's default
 * chain (for example, Base USDC on `price-current`). On any other chain it names
 * a token that does not exist there, so the flag becomes required instead.
 */
function withoutForeignAddressDefaults(
  params: Record<string, ParamSpec>,
  schemaChainId: unknown,
  chainId: number,
): Record<string, ParamSpec> {
  if (schemaChainId === chainId) return params;
  return Object.fromEntries(Object.entries(params).map(([name, param]) => {
    if (typeof param.default !== 'string' || !EVM_ADDRESS.test(param.default)) return [name, param];
    const { default: _default, ...rest } = param;
    return [name, { ...rest, required: true }];
  }));
}

function supportsChain(param: ParamSpec, chainId: number): boolean {
  return param.numericEnum?.includes(chainId) === true ||
    (param.min === chainId && param.max === chainId);
}

export function projectEvmMetadata(
  metadata: CambrianMetadataGroup,
  chainId: number,
): CambrianMetadataGroup {
  const spec = Object.fromEntries(Object.entries(metadata.spec).flatMap(([resource, endpoint]) => {
    const chain = endpoint.params.chain_id;
    if ((!chain && chainId !== BASE_CHAIN_ID) || (chain && !supportsChain(chain, chainId))) return [];
    if (!chain) return [[resource, endpoint]];
    const { numericEnum: _numericEnum, enumNames, ...rest } = chain;
    const name = enumNames?.[chainIdValues(chain).indexOf(chainId)];
    const projected: EndpointSpec = {
      ...endpoint,
      params: {
        ...withoutForeignAddressDefaults(endpoint.params, chain.default ?? BASE_CHAIN_ID, chainId),
        // The command group selects the chain, so the flag is pinned and hidden.
        chain_id: {
          ...rest,
          default: chainId,
          min: chainId,
          max: chainId,
          hidden: true,
          ...(name !== undefined ? { enumNames: [name] } : {}),
        },
      },
    };
    return [[resource, projected]];
  }));
  const resources = Object.keys(spec);
  return {
    ...metadata,
    resources,
    spec,
    cliDefaults: Object.fromEntries(
      Object.entries(metadata.cliDefaults).filter(([resource]) => resources.includes(resource)),
    ),
  };
}

/** Projects metadata for a chain table row. */
export function projectEvmChain(
  metadata: CambrianMetadataGroup,
  chain: EvmChain,
): CambrianMetadataGroup {
  return projectEvmMetadata(metadata, chain.chainId);
}

/** Back-compat helper: whether Ethereum mainnet is advertised by the active schema. */
export function hasEthereumSupport(metadata: CambrianMetadataGroup): boolean {
  return hasEvmChainSupport(metadata, ETHEREUM_CHAIN);
}

/**
 * Reads `/evm/chains` (one TableResponse, or a list of them, with `id` and
 * `name` columns) into chain id → name. Rows that do not fit are skipped.
 */
export function parseEvmChainNames(result: unknown): Record<string, string> {
  const names: Record<string, string> = {};
  for (const table of Array.isArray(result) ? result : [result]) {
    if (!table || typeof table !== 'object') continue;
    const { columns, data } = table as { columns?: unknown; data?: unknown };
    if (!Array.isArray(columns) || !Array.isArray(data)) continue;
    const column = (name: string) => columns.findIndex((entry) =>
      (entry as { name?: unknown } | null)?.name === name);
    const idIndex = column('id');
    const nameIndex = column('name');
    if (idIndex < 0 || nameIndex < 0) continue;
    for (const row of data) {
      if (!Array.isArray(row)) continue;
      const id = row[idIndex];
      const name = row[nameIndex];
      if (Number.isSafeInteger(id) && (id as number) > 0 && typeof name === 'string' && name.length <= 64) {
        names[String(id)] = name;
      }
    }
  }
  return names;
}
