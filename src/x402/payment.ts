/**
 * x402 payment primitives — pure, dependency-free (no viem / no @x402 here).
 *
 * Parses the gateway's 402 requirements and enforces the spend cap / cost
 * preview. The actual signing + payment is delegated to the official `@x402/*`
 * v2 SDK (see client.ts), which is wire-compatible with the gateway's own
 * `@x402/evm` server. We keep these helpers for the unpaid pre-flight probe that
 * powers `--max-amount` and the `--yes` cost preview. See docs/x402.md.
 */

import { CliUsageError } from '../cli/core.js';

export const X402_BASE_URL = 'https://x402.cambrian.network';
export const USDC_DECIMALS = 6;
/** Default per-call spend ceiling in micro-USDC ($0.10). */
export const DEFAULT_MAX_AMOUNT_MICRO = 100_000;

export interface PaymentRequirement {
  scheme: string;
  network: string; // CAIP-2, e.g. "eip155:8453"
  /** Cambrian's gateway uses `amount`; the spec field is `maxAmountRequired`. */
  amount?: string;
  maxAmountRequired?: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: { name?: string; version?: string };
}

export interface PaymentRequired {
  x402Version: number;
  accepts: PaymentRequirement[];
  resource?: { url?: string; description?: string; mimeType?: string };
}

/** Returns the price in micro-USDC, tolerating either field name. */
export function requirementAmount(req: PaymentRequirement): string {
  const raw = req.amount ?? req.maxAmountRequired;
  if (raw === undefined || !/^\d+$/.test(String(raw))) {
    throw new CliUsageError('x402: payment requirement has a missing/invalid amount.');
  }
  return String(raw);
}

/** Validates and narrows a parsed 402 JSON body into a PaymentRequired. */
export function parsePaymentRequired(body: unknown): PaymentRequired {
  if (!body || typeof body !== 'object') {
    throw new CliUsageError('x402: malformed 402 response (not an object).');
  }
  const o = body as Record<string, unknown>;
  if (!Array.isArray(o.accepts) || o.accepts.length === 0) {
    throw new CliUsageError('x402: 402 response has no payment options (accepts[]).');
  }
  return o as unknown as PaymentRequired;
}

/**
 * Selects the requirement to preview/cap. Defaults to the first `exact`-scheme
 * entry on an `eip155:` (EVM) network — that is what the CLI's signer supports.
 */
export function selectRequirement(pr: PaymentRequired): PaymentRequirement {
  const req = pr.accepts.find(
    (a) => a.scheme === 'exact' && typeof a.network === 'string' && a.network.startsWith('eip155:'),
  );
  if (!req) {
    throw new CliUsageError(
      'x402: no supported payment option (need scheme "exact" on an EVM/eip155 network).',
    );
  }
  requirementAmount(req); // validates the amount field
  return req;
}

/**
 * Formats micro-USDC as a human dollar string, keeping at least 2 decimals and
 * trimming excess trailing zeros: 50000 → "$0.05", 100000 → "$0.10",
 * 1000000 → "$1.00", 1 → "$0.000001".
 */
export function formatUsd(micro: string | number): string {
  const n = (typeof micro === 'string' ? Number(micro) : micro) / 10 ** USDC_DECIMALS;
  const trimmed = n.toFixed(USDC_DECIMALS).replace(/(\.\d{2}\d*?)0+$/, '$1');
  return `$${trimmed}`;
}

/** Converts a `--max-amount` dollar string to micro-USDC (throws if invalid). */
export function usdToMicro(usd: string): number {
  const n = Number(usd);
  if (!Number.isFinite(n) || n < 0) {
    throw new CliUsageError('--max-amount must be a non-negative dollar amount (e.g. 0.10).');
  }
  return Math.round(n * 10 ** USDC_DECIMALS);
}

/** Throws unless the requirement's amount is within the cap (micro-USDC). */
export function assertWithinCap(req: PaymentRequirement, capMicro: number): void {
  const amount = Number(requirementAmount(req));
  if (amount > capMicro) {
    throw new CliUsageError(
      `x402: price ${formatUsd(amount)} exceeds your --max-amount ${formatUsd(capMicro)}. ` +
        'Raise --max-amount to authorize.',
    );
  }
}
