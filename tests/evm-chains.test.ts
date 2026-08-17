import { describe, expect, it } from 'vitest';
import type { CambrianMetadataGroup, EndpointSpec } from '../src/metadata.js';
import {
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
  hasEthereumSupport,
  projectEvmMetadata,
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
