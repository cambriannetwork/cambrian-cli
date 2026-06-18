/**
 * Unit tests for the pure x402 payment primitives (no viem / no @x402, no
 * network): parsing the 402, selecting a requirement, the spend cap, and USD
 * formatting. Signing/paying is the @x402 SDK's job and is covered elsewhere.
 */

import { describe, it, expect } from 'vitest';
import {
  parsePaymentRequired,
  selectRequirement,
  requirementAmount,
  formatUsd,
  usdToMicro,
  assertWithinCap,
  type PaymentRequired,
} from '../src/x402/payment.js';
import { CliUsageError } from '../src/cli/core.js';

// The live contract shape (verified against x402.cambrian.network): note the V2
// `amount` field and CAIP-2 network.
const PR: PaymentRequired = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453',
      amount: '50000',
      payTo: '0x4c3b0b1cab290300bd5a36ad5f33a607acbd7ac3',
      maxTimeoutSeconds: 600,
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      extra: { name: 'USD Coin', version: '2' },
    },
  ],
  resource: { url: 'https://x402.cambrian.network/api/v1/deep42/x', description: 'x' },
};

describe('parse & select', () => {
  it('parses a valid 402 body and selects the exact/eip155 requirement', () => {
    const req = selectRequirement(parsePaymentRequired(PR));
    expect(requirementAmount(req)).toBe('50000');
    expect(req.network).toBe('eip155:8453');
  });

  it('throws on a body with no accepts[]', () => {
    expect(() => parsePaymentRequired({})).toThrowError(CliUsageError);
    expect(() => parsePaymentRequired({ accepts: [] })).toThrowError(CliUsageError);
  });

  it('throws when no supported (exact/eip155) option exists', () => {
    const solana = { x402Version: 2, accepts: [{ ...PR.accepts[0], network: 'solana:mainnet' }] };
    expect(() => selectRequirement(solana as PaymentRequired)).toThrowError(CliUsageError);
  });
});

describe('requirementAmount', () => {
  it('tolerates both `amount` (gateway) and `maxAmountRequired` (spec)', () => {
    expect(requirementAmount({ ...PR.accepts[0], amount: '50000' })).toBe('50000');
    const spec = { ...PR.accepts[0], amount: undefined, maxAmountRequired: '70000' };
    expect(requirementAmount(spec)).toBe('70000');
  });
  it('throws on a missing/invalid amount', () => {
    expect(() => requirementAmount({ ...PR.accepts[0], amount: undefined })).toThrowError(CliUsageError);
  });
});

describe('formatUsd / usdToMicro', () => {
  it('formats micro-USDC with >=2 decimals, trimming extra zeros', () => {
    expect(formatUsd('50000')).toBe('$0.05');
    expect(formatUsd(100000)).toBe('$0.10');
    expect(formatUsd(1000000)).toBe('$1.00');
    expect(formatUsd(1)).toBe('$0.000001');
  });
  it('converts dollars to micro-USDC', () => {
    expect(usdToMicro('0.10')).toBe(100000);
    expect(usdToMicro('1')).toBe(1000000);
    expect(() => usdToMicro('-1')).toThrowError(CliUsageError);
    expect(() => usdToMicro('abc')).toThrowError(CliUsageError);
  });
});

describe('assertWithinCap', () => {
  it('passes at or under the cap, throws above', () => {
    expect(() => assertWithinCap(PR.accepts[0], 50000)).not.toThrow();
    expect(() => assertWithinCap(PR.accepts[0], 100000)).not.toThrow();
    expect(() => assertWithinCap(PR.accepts[0], 10000)).toThrowError(CliUsageError);
  });
});
