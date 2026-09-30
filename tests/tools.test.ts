import { describe, expect, it } from 'vitest';
import { CAMBRIAN_METADATA_GROUPS } from '../src/metadata.js';
import { buildToolQuery, listCambrianCliTools, toolInputSchema, ToolArgumentError } from '../src/tools.js';

const tools = listCambrianCliTools(CAMBRIAN_METADATA_GROUPS);
const byName = (name: string) => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing ${name}`);
  return tool;
};
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ToolArgumentError) return [error.code, error.param, error.message];
    throw error;
  }
  throw new Error('expected ToolArgumentError');
};

describe('listCambrianCliTools', () => {
  it('projects EVM commands per chain and keeps the Base USDC default on Base only', () => {
    const base = byName('cambrian_base_price_current');
    const ethereum = byName('cambrian_ethereum_price_current');
    expect(base.chain?.chainId).toBe(8453);
    expect(ethereum.chain?.chainId).toBe(1);
    expect(ethereum.description).toBe('Query Cambrian Ethereum mainnet price current data.');
    expect(toolInputSchema(base).required).toBeUndefined();
    expect(toolInputSchema(ethereum).required).toEqual(['token_address']);
    expect(toolInputSchema(ethereum).properties).not.toHaveProperty('chain_id');
    expect(buildToolQuery(ethereum, { token_address: '0x' + 'a'.repeat(40) }).chain_id).toBe(1);
  });

  it('treats a CLI default as optional, advertises it, and applies it', () => {
    const orca = byName('cambrian_solana_orca_pools');
    expect(toolInputSchema(orca).required).toBeUndefined();
    expect(toolInputSchema(orca).properties?.dex).toMatchObject({ default: 'orca' });
    expect(toolInputSchema(byName('cambrian_base_aero_v2_pool')).properties?.apr_days_annualized)
      .toMatchObject({ type: 'integer', default: 30 });
    expect(buildToolQuery(orca, {})).toMatchObject({ dex: 'orca', limit: 100 });
  });
});

describe('buildToolQuery', () => {
  const pools = byName('cambrian_base_uniswap_v3_pools');

  it('comma-joins explode=false sort arrays and keeps empty sort positions', () => {
    expect(buildToolQuery(pools, { order_desc: ['fee', 'createdAt'] }).order_desc).toBe('fee,createdAt');
    expect(buildToolQuery(pools, { order_asc: ['fee', ''], order_desc: ['', 'createdAt'] }))
      .toMatchObject({ order_asc: 'fee,', order_desc: ',createdAt' });
  });

  it('maps every CLI usage error to a tool argument code', () => {
    const risk = byName('cambrian_risk_perp_risk_engine');
    expect(codeOf(() => buildToolQuery(pools, { nope: 1 }))[0]).toBe('UNKNOWN_PARAMETER');
    expect(codeOf(() => buildToolQuery(risk, {}))).toEqual([
      'MISSING_REQUIRED', 'token_address', 'Missing required parameter "token_address" for cambrian_risk_perp_risk_engine.',
    ]);
    expect(codeOf(() => buildToolQuery(pools, { limit: 0 }))).toEqual([
      'BELOW_MINIMUM', 'limit', 'Parameter "limit" must be at least 1.',
    ]);
    expect(codeOf(() => buildToolQuery(pools, { limit: 10001 }))[0]).toBe('ABOVE_MAXIMUM');
    expect(codeOf(() => buildToolQuery(pools, { limit: 2.5 }))[0]).toBe('INVALID_TYPE');
    expect(codeOf(() => buildToolQuery(pools, { order_desc: ['tvl'] }))[0]).toBe('INVALID_ENUM');
    expect(codeOf(() => buildToolQuery(pools, { order_asc: ['fee'], order_desc: ['fee'] }))[0]).toBe('INVALID_SORT');
    expect(codeOf(() => buildToolQuery(pools, { token_address: '0x1' }))[0]).toBe('PATTERN_MISMATCH');
    expect(codeOf(() => buildToolQuery(pools, { limit: { n: 1 } }))).toEqual([
      'INVALID_TYPE', 'limit', 'Parameter "limit" must be an integer.',
    ]);
    expect(codeOf(() => buildToolQuery(risk, {
      token_address: 'So11111111111111111111111111111111111111112',
      entry_price: '0x10',
      leverage: 2,
      direction: 'long',
      risk_horizon: '1d',
    }))).toEqual(['INVALID_TYPE', 'entry_price', 'Parameter "entry_price" must be a number.']);
  });
});
