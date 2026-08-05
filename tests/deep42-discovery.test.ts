import { describe, expect, it } from 'vitest';
import { Deep42Client } from '../src/client/deep42.js';

function specFetch(spec: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(spec));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('Deep42Client.discoverEndpoints', () => {
  it('uses the configured client URL and request headers', async () => {
    const { fetch, calls } = specFetch({ paths: {} });
    const client = new Deep42Client({
      apiKey: 'test-key',
      baseUrl: 'https://deep42.example.test',
      fetch,
    });

    await client.discoverEndpoints();

    expect(calls[0].url).toBe('https://deep42.example.test/openapi.json');
    expect(new Headers(calls[0].init?.headers).get('X-API-KEY')).toBe('test-key');
  });

  it('returns only concrete Deep42 GET endpoints from the gateway spec', async () => {
    const { fetch } = specFetch({
      paths: {
        '/api/v1/deep42/social-data/sentiment-shifts': {
          get: { summary: 'Sentiment shifts', parameters: [] },
          post: { summary: 'Sentiment shifts POST', parameters: [] },
          servers: [{ url: 'https://api.cambrian.org' }],
        },
        '/api/v1/deep42/{path}': { get: {}, post: {} },
        '/api/v1/solana/{path}': { get: {} },
        '/health': { get: {} },
      },
    });
    const client = new Deep42Client({ apiKey: 'test', fetch });

    const endpoints = await client.discoverEndpoints();

    expect([...endpoints.entries()]).toEqual([
      [
        'social-data/sentiment-shifts',
        {
          path: '/api/v1/deep42/social-data/sentiment-shifts',
          method: 'GET',
          summary: 'Sentiment shifts',
          parameters: [],
        },
      ],
    ]);
  });
});
