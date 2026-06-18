import { BaseClient } from './base-client.js';
import type { BaseClientOptions } from './types.js';

const DEFAULT_BASE_URL = 'https://deep42.cambrian.network';
const OPENAPI_SPEC_URL = 'https://deep42.cambrian.network/openapi.json';

export interface Deep42EndpointInfo {
  path: string;
  method: string;
  summary?: string;
  parameters: { name: string; required: boolean; schema?: { type?: string; enum?: string[] } }[];
}

export class Deep42Client extends BaseClient {
  private _endpointCache: Map<string, Deep42EndpointInfo> | null = null;

  constructor(opts: BaseClientOptions) {
    super({ ...opts, defaultBaseUrl: DEFAULT_BASE_URL });
  }

  /**
   * Generic query: call any Deep42 API path with arbitrary query params.
   * Supports optional PAYMENT-SIGNATURE header for x402 endpoints.
   */
  async query(
    apiPath: string,
    params: Record<string, string | number | boolean | undefined> = {},
    paymentSignature?: string,
  ): Promise<unknown> {
    const qs = this.buildParams(params);
    const fullPath = qs ? `${apiPath}?${qs}` : apiPath;
    const init: RequestInit = {};
    if (paymentSignature) {
      const headers = new Headers();
      headers.set('PAYMENT-SIGNATURE', paymentSignature);
      init.headers = headers;
    }
    return this.request(fullPath, init);
  }

  /**
   * Fetch the Deep42 OpenAPI spec and extract available endpoints.
   * Results are cached in-memory for the session.
   */
  async discoverEndpoints(): Promise<Map<string, Deep42EndpointInfo>> {
    if (this._endpointCache) return this._endpointCache;

    const res = await this.fetchFn(OPENAPI_SPEC_URL);
    if (!res.ok) {
      throw new Error(`Failed to fetch Deep42 OpenAPI spec: ${res.status}`);
    }
    const spec = await res.json() as {
      paths?: Record<string, Record<string, {
        summary?: string;
        parameters?: { name: string; required?: boolean; in?: string; schema?: { type?: string; enum?: string[] } }[];
      }>>;
    };

    const endpoints = new Map<string, Deep42EndpointInfo>();
    if (spec.paths) {
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, detail] of Object.entries(methods)) {
          if (method === 'parameters' || typeof detail !== 'object' || !detail) continue;
          // Convert /api/v1/deep42/social-data/alpha-tweet-detection -> social-data/alpha-tweet-detection
          const shortPath = path.replace(/^\/api\/v1\/deep42\//, '');
          // Convert to CLI resource name: social-data/alpha-tweet-detection -> alpha-tweet-detection
          // Keep the full short path as resource key for unique identification
          const params = (detail.parameters ?? [])
            .filter((p: { in?: string }) => p.in === 'query')
            .map((p: { name: string; required?: boolean; schema?: { type?: string; enum?: string[] } }) => ({
              name: p.name,
              required: p.required === true,
              schema: p.schema,
            }));
          endpoints.set(shortPath, {
            path,
            method: method.toUpperCase(),
            summary: detail.summary,
            parameters: params,
          });
        }
      }
    }

    this._endpointCache = endpoints;
    return endpoints;
  }

  /**
   * Clear the cached endpoint discovery.
   */
  clearEndpointCache(): void {
    this._endpointCache = null;
  }
}
