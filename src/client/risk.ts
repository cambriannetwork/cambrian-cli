import { BaseClient } from './base-client.js';
import type { BaseClientOptions, LiquidationRiskParams, LiquidationRiskResponse } from './types.js';

const DEFAULT_BASE_URL = 'https://risk.cambrian.network';

export class RiskClient extends BaseClient {
  constructor(opts: BaseClientOptions) {
    super({ ...opts, defaultBaseUrl: DEFAULT_BASE_URL });
  }

  /**
   * Generic query: call any Risk API path with arbitrary params.
   * apiPath as stored in openapi-params.json (may lack leading slash).
   */
  async query(apiPath: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    const q = this.buildParams(params);
    return this.request(q ? `${path}?${q}` : path);
  }

  async getLiquidationRisk(opts: LiquidationRiskParams): Promise<LiquidationRiskResponse> {
    return this.request(`/api/v1/perp-risk-engine?${this.buildParams(opts)}`);
  }
}
