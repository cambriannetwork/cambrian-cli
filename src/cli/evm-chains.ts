import type { CambrianMetadataGroup, EndpointSpec, ParamSpec } from '../metadata.js';

/**
 * Single source of truth for every EVM chain the CLI exposes as a command group.
 *
 * Adding a chain is a two-step, deterministic operation:
 *   1. Confirm the chain id appears in the `chain_id` enum of the live EVM
 *      OpenAPI document for the endpoints you expect (see the
 *      `add-evm-chain` skill). The runtime registry normalises those enums into
 *      `numericEnum`/`min`/`max` metadata automatically, so no per-endpoint code
 *      is required here.
 *   2. Add one row below. Everything downstream — command dispatch, help,
 *      completion, OpenCLI, docs fallback, schema groups, and the x402 pay
 *      command — derives from this table and the projected metadata.
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

/** Resolves a CLI group token (`base`, `ethereum`, `arbitrum`, `evm`, `chain-<id>`) to its chain. */
export function evmChainForToken(token: string): EvmChain | undefined {
  if (token === 'evm') return DEFAULT_EVM_CHAIN;
  const known = EVM_CHAIN_BY_TOKEN.get(token);
  if (known) return known;
  const syntheticId = syntheticEvmChainId(token);
  return syntheticId === undefined ? undefined : syntheticEvmChain(syntheticId);
}

/** Resolves a CLI group token to a chain id, or undefined when it is not EVM. */
export function evmChainIdForToken(token: string): number | undefined {
  return evmChainForToken(token)?.chainId;
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
    if (chain.numericEnum) for (const id of chain.numericEnum) ids.add(id);
    if (typeof chain.min === 'number' && chain.min === chain.max) ids.add(chain.min);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Every EVM chain command the active schema advertises: curated chains that
 * have support, followed by `chain-<id>` tokens for advertised ids without a
 * curated row. This is what dispatch, help, completion, OpenCLI, docs, and
 * `cambrian pay` enumerate, so new chains appear without a CLI upgrade.
 */
export function discoverEvmChains(metadata: CambrianMetadataGroup): EvmChain[] {
  const curated = supportedEvmChains(metadata);
  const named = new Set(curated.map((chain) => chain.chainId));
  const extras = advertisedEvmChainIds(metadata)
    .filter((id) => !named.has(id))
    .map((id) => syntheticEvmChain(id));
  return [...curated, ...extras];
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
    const { numericEnum: _numericEnum, ...rest } = chain;
    const projected: EndpointSpec = {
      ...endpoint,
      params: {
        ...withoutForeignAddressDefaults(endpoint.params, chain.default ?? BASE_CHAIN_ID, chainId),
        chain_id: { ...rest, default: chainId, min: chainId, max: chainId },
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
