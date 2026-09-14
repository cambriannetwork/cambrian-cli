import { describe, expect, it } from 'vitest';
import {
  auditEvmChains,
  auditNormalizedEvmChains,
  normalizedChainSupport,
  openApiChainSupport,
} from '../src/cli/evm-chain-audit.js';

function rawDocument(paths: Record<string, unknown>): unknown {
  return { openapi: '3.0.0', info: { title: 'EVM', version: '1' }, paths };
}

function chainParam(enumValues?: number[], minMax?: [number, number]) {
  return {
    name: 'chain_id',
    in: 'query',
    schema: enumValues
      ? { type: 'integer', enum: enumValues }
      : { type: 'integer', minimum: minMax![0], maximum: minMax![1] },
  };
}

describe('openApiChainSupport', () => {
  it('extracts enum and single-value ranges, skipping chain-neutral paths', () => {
    const support = openApiChainSupport(rawDocument({
      '/evm/tokens': { get: { parameters: [chainParam([1, 8453, 42161])] } },
      '/evm/dexes': { get: { parameters: [chainParam([1, 8453, 42161])] } },
      '/evm/aero/v2/pools': { get: { parameters: [chainParam([8453])] } },
      '/evm/chains': { get: { parameters: [] } },
    }));

    expect(support.get('/evm/tokens')).toEqual([1, 8453, 42161]);
    expect(support.get('/evm/aero/v2/pools')).toEqual([8453]);
    expect(support.has('/evm/chains')).toBe(false);
  });

  it('reads a pinned minimum/maximum chain_id as a single value', () => {
    const support = openApiChainSupport(rawDocument({
      '/evm/tokens': { get: { parameters: [chainParam(undefined, [42161, 42161])] } },
    }));
    expect(support.get('/evm/tokens')).toEqual([42161]);
  });

  it('returns an empty map for malformed documents', () => {
    expect(openApiChainSupport(null).size).toBe(0);
    expect(openApiChainSupport({}).size).toBe(0);
    expect(openApiChainSupport({ paths: [] }).size).toBe(0);
  });
});

describe('normalizedChainSupport', () => {
  it('reads numericEnum and single-value min/max, skipping neutral resources', () => {
    const support = normalizedChainSupport({
      evm: {
        tokens: { params: { chain_id: { numericEnum: [1, 8453, 42161] } } },
        'aero-v2-pools': { params: { chain_id: { min: 8453, max: 8453 } } },
        chains: { params: {} },
      },
    });
    expect(support.get('tokens')).toEqual([1, 8453, 42161]);
    expect(support.get('aero-v2-pools')).toEqual([8453]);
    expect(support.has('chains')).toBe(false);
  });
});

describe('auditEvmChains', () => {
  const chainFixtures = [
    { command: 'base', chainId: 8453, label: 'Base', group: 'base' as const },
    { command: 'ethereum', chainId: 1, label: 'Ethereum mainnet', group: 'base' as const },
    { command: 'arbitrum', chainId: 42161, label: 'Arbitrum One', group: 'base' as const },
  ];

  it('reports full coverage when the registry matches the document', () => {
    const audit = auditEvmChains(rawDocument({
      '/evm/tokens': { get: { parameters: [chainParam([1, 8453, 42161])] } },
      '/evm/aero/v2/pools': { get: { parameters: [chainParam([8453])] } },
    }), chainFixtures);

    expect(audit.discoveredChainIds).toEqual([1, 8453, 42161]);
    expect(audit.unregisteredChainIds).toEqual([]);
    expect(audit.unsupportedChains).toEqual([]);
    expect(audit.perChain.map((entry) => entry.chain.command)).toEqual(['base', 'ethereum', 'arbitrum']);
    expect(audit.perChain.every((entry) => entry.endpoints > 0)).toBe(true);
  });

  it('flags a chain the API serves but the registry does not know', () => {
    const audit = auditEvmChains(rawDocument({
      '/evm/tokens': { get: { parameters: [chainParam([1, 8453, 42161, 10])] } },
    }), chainFixtures);

    expect(audit.discoveredChainIds).toEqual([1, 10, 8453, 42161]);
    expect(audit.unregisteredChainIds).toEqual([10]);
  });

  it('flags a registry chain the document does not advertise', () => {
    const audit = auditEvmChains(rawDocument({
      '/evm/tokens': { get: { parameters: [chainParam([8453])] } },
    }), chainFixtures);

    expect(audit.unsupportedChains.map((chain) => chain.command)).toEqual(['ethereum', 'arbitrum']);
  });
});

describe('auditNormalizedEvmChains', () => {
  it('audits the bundled snapshot format offline', () => {
    const audit = auditNormalizedEvmChains({
      evm: {
        tokens: { params: { chain_id: { numericEnum: [1, 8453, 42161] } } },
        dexes: { params: { chain_id: { numericEnum: [1, 8453, 42161] } } },
        'aero-v2-pools': { params: { chain_id: { min: 8453, max: 8453 } } },
      },
    });

    expect(audit.discoveredChainIds).toEqual([1, 8453, 42161]);
    expect(audit.unregisteredChainIds).toEqual([]);
    expect(audit.perChain.find((entry) => entry.chain.command === 'arbitrum')?.endpoints).toBe(2);
  });
});
