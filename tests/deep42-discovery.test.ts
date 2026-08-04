/**
 * Tests for Deep42 OpenAPI endpoint discovery.
 *
 * discoverEndpoints() is part of the exported client surface but had no
 * coverage, so three problems went unnoticed: it bypassed request() (losing
 * timeout, retry, auth and ApiError mapping), it hardcoded the production
 * host instead of honouring a custom baseUrl, and its path-item filter let
 * non-operation keys through.
 */

import { describe, it, expect } from 'vitest';
import { Deep42Client } from '../src/client/deep42.js';

type FetchCall = { url: string; init?: RequestInit };

/** A fetch stub that records calls and replies with the given OpenAPI spec. */
function specFetch(spec: unknown, calls: FetchCall[] = []) {
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(spec), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const minimalSpec = {
  paths: {
    '/api/v1/deep42/social-data/sentiment-shifts': {
      get: {
        summary: 'Sentiment shifts',
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'X-Trace', in: 'header', required: false, schema: { type: 'string' } },
        ],
      },
    },
  },
};

describe('Deep42Client.discoverEndpoints', () => {
  it('sends the API key with the spec request', async () => {
    const { fetch, calls } = specFetch(minimalSpec);
    const client = new Deep42Client({ apiKey: 'secret-key', fetch });

    await client.discoverEndpoints();

    expect(new Headers(calls[0].init?.headers).get('x-api-key')).toBe('secret-key');
  });

  it('requests the spec from a custom baseUrl instead of the hardcoded host', async () => {
    const { fetch, calls } = specFetch(minimalSpec);
    const client = new Deep42Client({
      apiKey: 'k',
      fetch,
      baseUrl: 'https://deep42.example.test',
    });

    await client.discoverEndpoints();

    expect(calls[0].url).toBe('https://deep42.example.test/openapi.json');
  });

  it('ignores non-operation path item keys such as servers', async () => {
    const { fetch } = specFetch({
      paths: {
        // `servers` deliberately comes after `get`: it is an array, so a bare
        // typeof check treats it as an operation and it overwrites the real
        // GET entry that shares the same map key.
        '/api/v1/deep42/social-data/token-analysis': {
          get: { summary: 'Token analysis', parameters: [] },
          summary: 'Token analysis',
          servers: [{ url: 'https://deep42.cambrian.network' }],
        },
      },
    });
    const client = new Deep42Client({ apiKey: 'k', fetch });

    const endpoints = await client.discoverEndpoints();

    expect([...endpoints.values()].map((e) => e.method)).toEqual(['GET']);
    expect([...endpoints.values()].map((e) => e.method)).not.toContain('SERVERS');
  });

  it('shortens the path, uppercases the method and keeps only query params', async () => {
    const { fetch } = specFetch(minimalSpec);
    const client = new Deep42Client({ apiKey: 'k', fetch });

    const endpoints = await client.discoverEndpoints();
    const entry = endpoints.get('social-data/sentiment-shifts');

    expect(entry?.method).toBe('GET');
    expect(entry?.path).toBe('/api/v1/deep42/social-data/sentiment-shifts');
    expect(entry?.parameters.map((p) => p.name)).toEqual(['limit']);
  });

  it('maps a failing spec request to an ApiError carrying the status', async () => {
    const fetch = (async () =>
      new Response('nope', { status: 503 })) as unknown as typeof globalThis.fetch;
    const client = new Deep42Client({ apiKey: 'k', fetch, maxRetries: 0 });

    await expect(client.discoverEndpoints()).rejects.toMatchObject({ status: 503 });
  });

  it('caches the spec and clears it on clearEndpointCache', async () => {
    const { fetch, calls } = specFetch(minimalSpec);
    const client = new Deep42Client({ apiKey: 'k', fetch });

    await client.discoverEndpoints();
    await client.discoverEndpoints();
    expect(calls).toHaveLength(1);

    client.clearEndpointCache();
    await client.discoverEndpoints();
    expect(calls).toHaveLength(2);
  });
});
