import { BaseClient } from './base-client.js';
import type { BaseClientOptions } from './types.js';

const DEFAULT_BASE_URL = 'https://api.cambrian.org/deep42';
const OPENAPI_SPEC_PATH = '/openapi.json';
const DEEP42_PATH_PREFIX = '/api/v1/deep42/';

export interface Deep42EndpointInfo {
  path: string;
  method: string;
  summary?: string;
  parameters: { name: string; required: boolean; schema?: { type?: string; enum?: string[] } }[];
}

/**
 * Accept header that selects one API version of a Deep42 endpoint, for example
 * `application/vnd.cambrian.deep42.social-data.influencer-credibility.v4.1.0+json`.
 */
export function deep42AcceptHeader(apiPath: string, version: string): string {
  const endpoint = apiPath.split('?')[0]
    .replace(/^\/api\/v1\//, '').replace(/^\/|\/$/g, '').replace(/\//g, '.');
  return `application/vnd.cambrian.${endpoint}.v${version}+json`;
}

export interface Deep42QueryOptions {
  /** API version such as `4.1.0`. Without it the API answers with its default version. */
  apiVersion?: string;
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
    options: Deep42QueryOptions = {},
  ): Promise<unknown> {
    const path = apiPath.replace(/^\/api\/v1\/deep42/, '');
    const qs = this.buildParams(params);
    const fullPath = qs ? `${path}?${qs}` : path;
    const headers = new Headers();
    if (paymentSignature) headers.set('PAYMENT-SIGNATURE', paymentSignature);
    if (options.apiVersion) headers.set('Accept', deep42AcceptHeader(`/deep42${path}`, options.apiVersion));
    return this.request(fullPath, { headers });
  }

  /**
   * Fetch the Deep42 OpenAPI spec and extract available endpoints.
   * Results are cached in-memory for the session.
   */
  async discoverEndpoints(): Promise<Map<string, Deep42EndpointInfo>> {
    if (this._endpointCache) return this._endpointCache;

    const spec = await this.request<{
      paths?: Record<string, Record<string, {
        summary?: string;
        parameters?: { name: string; required?: boolean; in?: string; schema?: { type?: string; enum?: string[] } }[];
      }>>;
    }>(OPENAPI_SPEC_PATH);

    const endpoints = new Map<string, Deep42EndpointInfo>();
    if (spec.paths) {
      for (const [path, methods] of Object.entries(spec.paths)) {
        if (!path.startsWith(DEEP42_PATH_PREFIX) || path.includes('{')) continue;
        for (const [method, detail] of Object.entries(methods)) {
          if (method !== 'get' || typeof detail !== 'object' || !detail) continue;
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
