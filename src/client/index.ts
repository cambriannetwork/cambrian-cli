import { OpabiniaClient } from './opabinia.js';
import { Deep42Client } from './deep42.js';
import { RiskClient } from './risk.js';
import type { CambrianClientOptions } from './types.js';

export class CambrianData {
  readonly opabinia: OpabiniaClient;
  readonly deep42: Deep42Client;
  readonly risk: RiskClient;

  constructor(opts: CambrianClientOptions) {
    this.opabinia = new OpabiniaClient({
      apiKey: opts.apiKey,
      baseUrl: opts.opabiniaBaseUrl,
      fetch: opts.fetch,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
    });
    this.deep42 = new Deep42Client({
      apiKey: opts.apiKey,
      baseUrl: opts.deep42BaseUrl,
      fetch: opts.fetch,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
    });
    this.risk = new RiskClient({
      apiKey: opts.apiKey,
      baseUrl: opts.riskBaseUrl,
      fetch: opts.fetch,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
    });
  }
}

// Re-export everything consumers need
export { ApiError, mapStatusToCode, isRetryableStatus, DEFAULT_TIMEOUT_MS } from './base-client.js';
export { OpabiniaClient } from './opabinia.js';
export { Deep42Client } from './deep42.js';
export { RiskClient } from './risk.js';
export type * from './types.js';
