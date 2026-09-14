import { describe, expect, it } from 'vitest';
import type { CambrianMetadataGroup, EndpointSpec } from '../src/metadata.js';
import {
  ARBITRUM_CHAIN,
  ARBITRUM_CHAIN_ID,
  BASE_CHAIN,
  BASE_CHAIN_ID,
  DEFAULT_EVM_CHAIN,
  ETHEREUM_CHAIN,
  ETHEREUM_CHAIN_ID,
  EVM_CHAINS,
  advertisedEvmChainIds,
  discoverEvmChains,
  evmChainForToken,
  evmChainIdForToken,
  hasEvmChainSupport,
  hasEthereumSupport,
  isSyntheticEvmChainToken,
  projectEvmChain,
  projectEvmMetadata,
  supportedEvmChainIds,
  supportedEvmChains,
  syntheticEvmChainId,
} from '../src/cli/evm-chains.js';

function endpoint(chainIds?: number[]): EndpointSpec {
  return {
    apiPath: '/api/v1/evm/test',
    method: 'GET',
    params: chainIds
      ? {
          chain_id: chainIds.length === 1
            ? { required: false, type: 'integer', min: chainIds[0], max: chainIds[0], default: chainIds[0], strict: true }
            : { required: false, type: 'integer', numericEnum: chainIds, default: 8453, strict: true },
        }
      : {},
  };
}

function metadata(entries: Record<string, EndpointSpec>): CambrianMetadataGroup {
  return {
    group: 'base',
    apiGroup: 'evm',
    resources: Object.keys(entries),
    spec: entries,
    cliDefaults: {},
  };
}

describe('EVM chain metadata projection', () => {
  it('keeps production-like metadata on Base and hides Ethereum', () => {
    const source = metadata({ chains: endpoint(), tokens: endpoint([8453]) });

    expect(hasEthereumSupport(source)).toBe(false);
    expect(projectEvmMetadata(source, BASE_CHAIN_ID).resources).toEqual(['chains', 'tokens']);
    expect(projectEvmMetadata(source, ETHEREUM_CHAIN_ID).resources).toEqual([]);
  });

  it('includes neutral and Base-capable resources on Base but only explicit Ethereum resources on Ethereum', () => {
    const source = metadata({
      chains: endpoint(),
      tokens: endpoint([1, 8453]),
      'aero-v2-pools': endpoint([8453]),
      'alien-v3-pools': endpoint([8453]),
    });

    expect(hasEthereumSupport(source)).toBe(true);
    expect(projectEvmMetadata(source, BASE_CHAIN_ID).resources)
      .toEqual(['chains', 'tokens', 'aero-v2-pools', 'alien-v3-pools']);

    const ethereum = projectEvmMetadata(source, ETHEREUM_CHAIN_ID);
    expect(ethereum.resources).toEqual(['tokens']);
    expect(ethereum.spec.tokens.params.chain_id).toMatchObject({
      default: 1,
      min: 1,
      max: 1,
    });
    expect(ethereum.spec.tokens.params.chain_id).not.toHaveProperty('numericEnum');
  });
});

describe('EVM chain registry', () => {
  it('exposes Base, Ethereum, and Arbitrum with stable ids', () => {
    expect(BASE_CHAIN).toMatchObject({ command: 'base', chainId: 8453 });
    expect(ETHEREUM_CHAIN).toMatchObject({ command: 'ethereum', chainId: 1 });
    expect(ARBITRUM_CHAIN).toMatchObject({ command: 'arbitrum', chainId: 42161 });
    expect(ARBITRUM_CHAIN.chainId).toBe(ARBITRUM_CHAIN_ID);
    expect(EVM_CHAINS.map((chain) => chain.command)).toEqual(['base', 'ethereum', 'arbitrum']);
    expect(DEFAULT_EVM_CHAIN.command).toBe('base');
  });

  it('resolves CLI tokens including the evm alias', () => {
    expect(evmChainIdForToken('base')).toBe(8453);
    expect(evmChainIdForToken('ethereum')).toBe(1);
    expect(evmChainIdForToken('arbitrum')).toBe(42161);
    expect(evmChainIdForToken('evm')).toBe(8453);
    expect(evmChainForToken('evm')).toBe(BASE_CHAIN);
    expect(evmChainForToken('solana')).toBeUndefined();
    expect(evmChainForToken('nope')).toBeUndefined();
  });

  it('advertises only the chains the active schema supports, Base first', () => {
    const baseOnly = metadata({ chains: endpoint(), tokens: endpoint([8453]) });
    expect(supportedEvmChains(baseOnly).map((chain) => chain.command)).toEqual(['base']);

    const triple = metadata({
      chains: endpoint(),
      tokens: endpoint([1, 8453, 42161]),
      'uniswap-v3-pools': endpoint([1, 8453, 42161]),
      'aero-v2-pools': endpoint([8453]),
    });
    expect(hasEvmChainSupport(triple, ARBITRUM_CHAIN)).toBe(true);
    expect(supportedEvmChainIds(triple)).toEqual([8453, 1, 42161]);
  });

  it('projects Arbitrum metadata with a pinned chain id and chain-appropriate resources', () => {
    const source = metadata({
      chains: endpoint(),
      tokens: endpoint([1, 8453, 42161]),
      'uniswap-v3-pools': endpoint([1, 8453, 42161]),
      'aero-v2-pools': endpoint([8453]),
    });

    const arbitrum = projectEvmChain(source, ARBITRUM_CHAIN);
    expect(arbitrum.resources).toEqual(['tokens', 'uniswap-v3-pools']);
    expect(arbitrum.resources).not.toContain('aero-v2-pools');
    expect(arbitrum.resources).not.toContain('chains');
    expect(arbitrum.spec.tokens.params.chain_id).toEqual({
      required: false,
      type: 'integer',
      default: 42161,
      min: 42161,
      max: 42161,
      strict: true,
    });
  });
});
describe('runtime EVM chain discovery', () => {
  const multiChain = () => metadata({
    chains: endpoint(),
    tokens: endpoint([1, 8453, 42161, 10]),
    'uniswap-v3-pools': endpoint([1, 8453, 42161]),
    'aero-v2-pools': endpoint([8453]),
  });

  it('parses chain-<id> tokens and ignores malformed ones', () => {
    expect(syntheticEvmChainId('chain-10')).toBe(10);
    expect(syntheticEvmChainId('chain-42161')).toBe(42161);
    expect(syntheticEvmChainId('chain-')).toBeUndefined();
    expect(syntheticEvmChainId('chain-x')).toBeUndefined();
    expect(syntheticEvmChainId('chain-0')).toBeUndefined();
    expect(syntheticEvmChainId('chain-10x')).toBeUndefined();
    expect(syntheticEvmChainId('base')).toBeUndefined();
  });

  it('resolves chain-<id> tokens to synthetic chains', () => {
    expect(evmChainForToken('chain-10')).toMatchObject({
      command: 'chain-10',
      chainId: 10,
      label: 'Chain 10',
      group: 'base',
    });
    expect(isSyntheticEvmChainToken('chain-10')).toBe(true);
    expect(isSyntheticEvmChainToken('base')).toBe(false);
    expect(evmChainForToken('nope')).toBeUndefined();
  });

  it('discovers advertised ids with no curated row, keeping curated chains first', () => {
    const discovered = discoverEvmChains(multiChain());
    expect(discovered.map((chain) => chain.command)).toEqual([
      'base', 'ethereum', 'arbitrum', 'chain-10',
    ]);
    expect(advertisedEvmChainIds(multiChain())).toEqual([1, 10, 8453, 42161]);
  });

  it('projects a synthetic chain to only its advertised resources', () => {
    const projection = projectEvmChain(multiChain(), evmChainForToken('chain-10')!);
    expect(projection.resources).toEqual(['tokens']);
    expect(projection.spec.tokens.params.chain_id).toMatchObject({ default: 10, min: 10, max: 10 });
  });

  it('adds no synthetic duplicates for curated chains', () => {
    const discovered = discoverEvmChains(metadata({
      chains: endpoint(),
      tokens: endpoint([1, 8453, 42161]),
    }));
    expect(discovered.map((chain) => chain.command)).toEqual(['base', 'ethereum', 'arbitrum']);
  });
});
