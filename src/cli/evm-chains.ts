import type { CambrianMetadataGroup, EndpointSpec, ParamSpec } from '../metadata.js';

export const BASE_CHAIN_ID = 8453;
export const ETHEREUM_CHAIN_ID = 1;

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
        ...endpoint.params,
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

export function hasEthereumSupport(metadata: CambrianMetadataGroup): boolean {
  return projectEvmMetadata(metadata, ETHEREUM_CHAIN_ID).resources.length > 0;
}
