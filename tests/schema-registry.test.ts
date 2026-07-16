import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { GroupSpec } from '../src/metadata.js';
import type { Runtime } from '../src/cli/core.js';
import { coerceValue, serializeQueryParams } from '../src/cli/dynamic-handler.js';
import {
  applyVisibilityPolicy,
  clearRegistryCache,
  loadRuntimeMetadataGroup,
  normalizeOpenApiGroup,
  parseLlmsEndpointKeys,
  REGISTRY_CACHE_VERSION,
  registryCachePath,
} from '../src/schema/registry.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryCacheRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cambrian-schema-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function testRuntime(fetch: typeof globalThis.fetch, cacheRoot: string): Runtime {
  return {
    stdout: () => {},
    stdoutRaw: () => {},
    stderr: () => {},
    fetch,
    env: { XDG_CACHE_HOME: cacheRoot },
    homedir: () => cacheRoot,
    isTTY: false,
  };
}

function openApi(paths: Record<string, unknown>): unknown {
  return {
    openapi: '3.1.0',
    info: { title: 'Fixture', version: '1.0.0' },
    paths,
  };
}

describe('normalizeOpenApiGroup', () => {
  it('normalizes a compatible new GET/query endpoint', () => {
    const result = normalizeOpenApiGroup('solana', openApi({
      '/api/v1/solana/new-metrics': {
        get: {
          description: 'New runtime metrics endpoint.',
          parameters: [
            {
              name: 'token_address',
              in: 'query',
              required: true,
              description: 'Solana token address.',
              schema: { type: 'string', pattern: '^[A-Za-z0-9]+$' },
            },
            {
              name: 'intervals',
              in: 'query',
              required: false,
              schema: {
                type: 'array',
                items: { type: 'string', enum: ['1h', '1d'] },
              },
              style: 'form',
              explode: false,
            },
          ],
        },
      },
    }));

    expect(result.rejected).toEqual([]);
    expect(result.spec['new-metrics']).toEqual({
      apiPath: '/api/v1/solana/new-metrics',
      method: 'GET',
      params: {
        token_address: {
          required: true,
          type: 'string',
          description: 'Solana token address.',
          pattern: '^[A-Za-z0-9]+$',
          strict: true,
        },
        intervals: {
          required: false,
          type: 'array',
          items: { type: 'string', enum: ['1h', '1d'] },
          style: 'form',
          explode: false,
          strict: true,
        },
      },
    });
  });

  it('rejects unsupported, catch-all, cross-group, and ambiguous operations', () => {
    const result = normalizeOpenApiGroup('base', openApi({
      '/api/v1/evm/new-post': { post: { parameters: [] } },
      '/api/v1/evm/{path}': { get: { parameters: [] } },
      '/api/v1/solana/wrong-group': { get: { parameters: [] } },
      '/api/v1/evm/with-body': {
        get: { parameters: [], requestBody: { required: true } },
      },
      '/api/v1/evm/with-path-param': {
        get: {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
      '/api/v1/evm/flag-collision': {
        get: {
          parameters: [
            { name: 'token_address', in: 'query', schema: { type: 'string' } },
            { name: 'token-address', in: 'query', schema: { type: 'string' } },
          ],
        },
      },
    }));

    expect(result.spec).toEqual({});
    expect(result.rejected.map((entry) => entry.reason)).toEqual(expect.arrayContaining([
      'unsupported_method',
      'parameterized_path',
      'request_body',
      'unsupported_parameter_location',
      'parameter_name_collision',
    ]));
  });

  it('rejects unsafe resource keys, unsupported array serialization, and invalid defaults', () => {
    const result = normalizeOpenApiGroup('solana', openApi({
      '/api/v1/solana/__proto__': { get: { parameters: [] } },
      '/api/v1/solana/percent%2Fescape': { get: { parameters: [] } },
      '/api/v1/solana/space-delimited': {
        get: {
          parameters: [{
            name: 'values',
            in: 'query',
            schema: { type: 'array', items: { type: 'string' } },
            style: 'spaceDelimited',
          }],
        },
      },
      '/api/v1/solana/bad-default': {
        get: {
          parameters: [{
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, default: 0 },
          }],
        },
      },
    }));

    expect(result.spec).toEqual({});
    expect(result.rejected.filter((entry) =>
      entry.reason === 'unsupported_parameter_schema')).toHaveLength(2);
  });

  it('scopes Deep42 to its own concrete routes', () => {
    const result = normalizeOpenApiGroup('deep42', openApi({
      '/api/v1/deep42/social-data/new-signal': { get: { parameters: [] } },
      '/api/v1/solana/{path}': { get: { parameters: [] } },
      '/api/v1/perp-risk-engine': { get: { parameters: [] } },
      '/health': { get: { parameters: [] } },
    }));

    expect(Object.keys(result.spec)).toEqual(['social-data/new-signal']);
  });

  it('honors operation-level parameter overrides from a path item', () => {
    const result = normalizeOpenApiGroup('solana', openApi({
      '/api/v1/solana/overridden-default': {
        parameters: [{
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', default: 1 },
        }],
        get: {
          parameters: [{
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 2 },
          }],
        },
      },
    }));

    expect(result.rejected).toEqual([]);
    expect(result.spec['overridden-default'].params.limit.default).toBe(2);
  });

  it('permanently rejects ambiguous flattened resource names', () => {
    const result = normalizeOpenApiGroup('solana', openApi({
      '/api/v1/solana/foo/bar': { get: { parameters: [] } },
      '/api/v1/solana/foo-bar': { get: { parameters: [] } },
      '/api/v1/solana/foo/bar/': { get: { parameters: [] } },
    }));

    expect(result.spec).not.toHaveProperty('foo-bar');
    expect(result.rejected.some((entry) =>
      entry.reason === 'resource_name_collision')).toBe(true);
  });
});

describe('runtime parameter validation and serialization', () => {
  it('uses strict integers for discovered params without changing legacy coercion', () => {
    expect(() => coerceValue('12abc', {
      required: true,
      type: 'integer',
      strict: true,
    }, 'limit')).toThrow('must be an integer');
    expect(coerceValue('12abc', {
      required: true,
      type: 'integer',
    }, 'limit')).toBe(12);
  });

  it('validates patterns and array item enums from discovered schemas', () => {
    expect(() => coerceValue('not-an-address', {
      required: true,
      type: 'string',
      pattern: '^0x[a-f0-9]{40}$',
      strict: true,
    }, 'wallet')).toThrow('invalid format');

    expect(coerceValue('1h,1d', {
      required: false,
      type: 'array',
      items: { type: 'string', enum: ['1h', '1d'] },
      strict: true,
    }, 'intervals')).toEqual(['1h', '1d']);
    expect(() => coerceValue('1h,1w', {
      required: false,
      type: 'array',
      items: { type: 'string', enum: ['1h', '1d'] },
      strict: true,
    }, 'intervals')).toThrow('must be one of');

    expect(coerceValue('1,2', {
      required: false,
      type: 'array',
      items: { type: 'integer', min: 1, max: 2 },
      minItems: 2,
      maxItems: 2,
      strict: true,
    }, 'values')).toEqual([1, 2]);
    expect(() => coerceValue('1', {
      required: false,
      type: 'array',
      items: { type: 'integer' },
      minItems: 2,
      strict: true,
    }, 'values')).toThrow('at least 2 values');
    expect(coerceValue('false', {
      required: true,
      type: 'boolean',
      strict: true,
    }, 'enabled')).toBe(false);
  });

  it('honors form/explode=false without changing legacy array serialization', () => {
    const discovered = {
      apiPath: '/api/v1/solana/new',
      method: 'GET',
      params: {
        intervals: {
          required: false,
          type: 'array',
          style: 'form',
          explode: false,
          strict: true,
        },
      },
    };
    expect(serializeQueryParams(discovered, { intervals: ['1h', '1d'] }))
      .toEqual({ intervals: '1h,1d' });
    expect(serializeQueryParams({
      ...discovered,
      params: { intervals: { required: false, type: 'array' } },
    }, { intervals: ['1h', '1d'] })).toEqual({ intervals: ['1h', '1d'] });
  });
});

describe('llms visibility for authoritative runtime operations', () => {
  const discovered: GroupSpec = Object.fromEntries(
    ['one', 'two', 'three', 'four', 'five', 'six'].map((name) => [
      name,
      { apiPath: `/api/v1/solana/${name}`, method: 'GET', params: {} },
    ]),
  );

  it('uses the documented intersection once five usable endpoints exist', () => {
    const keys = new Set(['one', 'two', 'three', 'four', 'five'].map(
      (name) => `GET /api/v1/solana/${name}`,
    ));
    const result = applyVisibilityPolicy(discovered, keys);
    expect(result.mode).toBe('llms-filtered');
    expect(Object.keys(result.spec)).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('falls back to compatible OpenAPI when fewer than five usable endpoints exist', () => {
    const keys = new Set(['one', 'two', 'three', 'four'].map(
      (name) => `GET /api/v1/solana/${name}`,
    ));
    const result = applyVisibilityPolicy(discovered, keys);
    expect(result.mode).toBe('openapi-sparse');
    expect(Object.keys(result.spec)).toEqual(['one', 'two', 'three', 'four', 'five', 'six']);
  });

  it('falls back to compatible OpenAPI when llms.txt has no usable inventory', () => {
    const result = applyVisibilityPolicy(discovered, new Set());
    expect(result.mode).toBe('openapi-sparse');
    expect(Object.keys(result.spec)).toEqual(Object.keys(discovered));
  });

  it('parses and deduplicates concrete endpoint keys from llms.txt', () => {
    const parsed = parseLlmsEndpointKeys(`
# Cambrian
- GET /api/v1/solana/one
- GET /api/v1/solana/one
- POST /api/v1/solana/two
- Docs: https://docs.cambrian.org/api/v1/solana/one/llms.txt
`);
    expect(parsed).toEqual(new Set([
      'GET /api/v1/solana/one',
      'POST /api/v1/solana/two',
    ]));
  });
});

describe('runtime registry cache and fallback', () => {
  const llms = `
# Cambrian
- GET /api/v1/deep42/social-data/alpha-tweet-detection
- GET /api/v1/deep42/social-data/influencer-credibility
- GET /api/v1/deep42/social-data/sentiment-shifts
- GET /api/v1/deep42/social-data/token-analysis
`;

  function deep42Document(extraPath = '/api/v1/deep42/social-data/new-signal'): unknown {
    return openApi({
      '/api/v1/deep42/social-data/alpha-tweet-detection': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/influencer-credibility': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/sentiment-shifts': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/token-analysis': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/trending-momentum': { get: { parameters: [] } },
      [extraPath]: {
        get: {
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
            },
          ],
        },
      },
    });
  }

  function schemaFetch(document: unknown): typeof globalThis.fetch {
    return (async (input) => {
      const url = String(input);
      if (url === 'https://deep42.cambrian.network/openapi.json') {
        return new Response(JSON.stringify(document), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: '"deep42-v1"' },
        });
      }
      if (url === 'https://docs.cambrian.org/llms.txt') {
        return new Response(llms, {
          status: 200,
          headers: { 'content-type': 'text/plain', etag: '"docs-v1"' },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof globalThis.fetch;
  }

  it('adds a compatible endpoint, writes cache, and keeps it available offline', async () => {
    const cacheRoot = temporaryCacheRoot();
    const live = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(deep42Document()), cacheRoot),
      { refresh: true, now: 1_000 },
    );

    expect(live.status.source).toBe('live');
    expect(live.status.visibilityMode).toBe('openapi-sparse');
    expect(live.status.additions).toEqual(['social-data/new-signal']);
    expect(live.metadata.resources).toContain('social-data/new-signal');
    expect(live.metadata.spec['social-data/new-signal'].params.limit).toMatchObject({
      type: 'integer', min: 1, max: 10, default: 3, strict: true,
    });
    expect(registryCachePath(testRuntime(schemaFetch(deep42Document()), cacheRoot), 'deep42'))
      .toContain(cacheRoot);
    if (process.platform !== 'win32') {
      const path = registryCachePath(testRuntime(schemaFetch(deep42Document()), cacheRoot), 'deep42');
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    }

    const offlineFetch = (async () => {
      throw new Error('offline');
    }) as typeof globalThis.fetch;
    const offline = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(offlineFetch, cacheRoot),
      { offline: true, now: 2_000 },
    );
    expect(offline.status.source).toBe('cache');
    expect(offline.metadata.resources).toContain('social-data/new-signal');
  });

  it('uses a valid live registry in memory when its cache cannot be persisted', async () => {
    const cacheRoot = temporaryCacheRoot();
    const blockedCacheRoot = join(cacheRoot, 'not-a-directory');
    writeFileSync(blockedCacheRoot, 'cache path intentionally blocked');

    const result = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(deep42Document()), blockedCacheRoot),
      { refresh: true, now: 1_000 },
    );

    expect(result.status.source).toBe('live');
    expect(result.status.warning).toContain('could not persist registry cache');
    expect(result.status.lastError).toBeUndefined();
    expect(result.metadata.resources).toContain('social-data/new-signal');
  });

  it('removes its atomic temporary file when the final cache rename fails', async () => {
    const cacheRoot = temporaryCacheRoot();
    const runtime = testRuntime(schemaFetch(deep42Document()), cacheRoot);
    const path = registryCachePath(runtime, 'deep42');
    mkdirSync(path, { recursive: true });

    const result = await loadRuntimeMetadataGroup(
      'deep42',
      runtime,
      { refresh: true, now: 1_000 },
    );

    expect(result.status.source).toBe('live');
    expect(result.status.warning).toContain('could not persist registry cache');
    expect(readdirSync(dirname(path)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('bounds oversized OpenAPI responses before parsing them', async () => {
    const cacheRoot = temporaryCacheRoot();
    const fetch = (async (input) => {
      const url = String(input);
      if (url === 'https://deep42.cambrian.network/openapi.json') {
        return new Response('{}', {
          status: 200,
          headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
        });
      }
      return new Response(llms, { status: 200 });
    }) as typeof globalThis.fetch;

    const result = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(fetch, cacheRoot),
      { refresh: true, now: 1_000 },
    );

    expect(result.status.source).toBe('bundle');
    expect(result.status.lastError).toContain('schema limit');
  });

  it('aborts a registry refresh at the configured timeout', async () => {
    const cacheRoot = temporaryCacheRoot();
    const fetch = (async (input, init) => {
      const url = String(input);
      if (url === 'https://docs.cambrian.org/llms.txt') {
        return new Response(llms, { status: 200 });
      }
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('OpenAPI refresh aborted at timeout')),
          { once: true },
        );
      });
    }) as typeof globalThis.fetch;

    const result = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(fetch, cacheRoot),
      { refresh: true, now: 1_000, timeoutMs: 5 },
    );

    expect(result.status.source).toBe('bundle');
    expect(result.status.lastError).toContain('aborted at timeout');
  });

  it('applies the authoritative live definition when OpenAPI changes a bundled endpoint', async () => {
    const cacheRoot = temporaryCacheRoot();
    const document = openApi({
      '/api/v1/deep42/social-data/token-analysis': {
        get: {
          parameters: [{
            name: 'breaking_required',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          }],
        },
      },
    });
    const result = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(document), cacheRoot),
      { refresh: true, now: 1_000 },
    );

    expect(result.status.driftedBundled).toContain('social-data/token-analysis');
    expect(result.metadata.spec['social-data/token-analysis'].params)
      .toMatchObject({
        breaking_required: { required: true, type: 'string', strict: true },
      });
    expect(result.metadata.spec['social-data/token-analysis'].params)
      .not.toHaveProperty('include_price_correlation');
  });

  it('forces a refresh for an unknown resource even while cache is fresh', async () => {
    const cacheRoot = temporaryCacheRoot();
    let document = deep42Document('/api/v1/deep42/social-data/first-addition');
    const fetch = schemaFetch(document);
    const runtime = testRuntime((async (input, init) => fetch(input, init)) as typeof globalThis.fetch, cacheRoot);
    await loadRuntimeMetadataGroup('deep42', runtime, { refresh: true, now: 1_000 });

    document = deep42Document('/api/v1/deep42/social-data/second-addition');
    const mutableRuntime = testRuntime((async (input) => {
      const url = String(input);
      if (url.includes('openapi.json')) return new Response(JSON.stringify(document), { status: 200 });
      return new Response(llms, { status: 200 });
    }) as typeof globalThis.fetch, cacheRoot);
    const refreshed = await loadRuntimeMetadataGroup('deep42', mutableRuntime, {
      missingResource: 'social-data/second-addition',
      now: 2_000,
    });
    expect(refreshed.status.source).toBe('live');
    expect(refreshed.metadata.resources).toContain('social-data/second-addition');
  });

  it('retains last-known-good additions when a refresh fails', async () => {
    const cacheRoot = temporaryCacheRoot();
    await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(deep42Document()), cacheRoot),
      { refresh: true, now: 1_000 },
    );
    const failing = testRuntime((async () => {
      throw new Error('network unavailable');
    }) as typeof globalThis.fetch, cacheRoot);
    const fallback = await loadRuntimeMetadataGroup('deep42', failing, {
      refresh: true,
      now: 2_000,
    });
    expect(fallback.status.source).toBe('cache');
    expect(fallback.status.lastError).toContain('network unavailable');
    expect(fallback.metadata.resources).toContain('social-data/new-signal');

    const laterStatus = await loadRuntimeMetadataGroup('deep42', failing, {
      offline: true,
      now: 2_500,
    });
    expect(laterStatus.status.lastError).toContain('network unavailable');
  });

  it('accepts a valid authoritative document that removes all compatible operations', async () => {
    const cacheRoot = temporaryCacheRoot();
    await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(deep42Document()), cacheRoot),
      { refresh: true, now: 1_000 },
    );

    const result = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(openApi({})), cacheRoot),
      { refresh: true, now: 2_000 },
    );
    expect(result.status.source).toBe('live');
    expect(result.status.lastError).toBeUndefined();
    expect(result.metadata.resources).toEqual([]);
  });

  it('uses the last-known-good cache when a refresh is not structurally valid OpenAPI', async () => {
    const cacheRoot = temporaryCacheRoot();
    await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(deep42Document()), cacheRoot),
      { refresh: true, now: 1_000 },
    );

    const invalid = {
      openapi: '3.1.0',
      info: { title: 'Missing paths', version: '1.0.0' },
    };
    const result = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(invalid), cacheRoot),
      { refresh: true, now: 2_000 },
    );

    expect(result.status.source).toBe('cache');
    expect(result.status.lastError).toContain('did not return an OpenAPI 3 document');
    expect(result.metadata.resources).toContain('social-data/new-signal');
  });

  it('applies llms.txt visibility to the entire authoritative registry', async () => {
    const cacheRoot = temporaryCacheRoot();
    const paths = Object.fromEntries(
      ['one', 'two', 'three', 'four', 'five', 'six'].map((name) => [
        `/api/v1/deep42/social-data/${name}`,
        { get: { parameters: [] } },
      ]),
    );
    const documented = ['one', 'two', 'three', 'four', 'five']
      .map((name) => `GET /api/v1/deep42/social-data/${name}`)
      .join('\n');
    const fetch = (async (input) => {
      const url = String(input);
      if (url === 'https://deep42.cambrian.network/openapi.json') {
        return new Response(JSON.stringify(openApi(paths)), { status: 200 });
      }
      if (url === 'https://docs.cambrian.org/llms.txt') {
        return new Response(documented, { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof globalThis.fetch;

    const result = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(fetch, cacheRoot),
      { refresh: true, now: 1_000 },
    );

    expect(result.status.visibilityMode).toBe('llms-filtered');
    expect(result.metadata.resources).toEqual([
      'social-data/one',
      'social-data/two',
      'social-data/three',
      'social-data/four',
      'social-data/five',
    ]);
    expect(result.status.hiddenByLlms).toEqual(['social-data/six']);
    expect(result.metadata.resources).not.toContain('social-data/token-analysis');
  });

  it('retains a CLI compatibility default only while active OpenAPI accepts it', async () => {
    const cacheRoot = temporaryCacheRoot();
    const document = openApi({
      '/api/v1/evm/aero/v2/pool': {
        get: {
          parameters: [{
            name: 'apr_days_annualized',
            in: 'query',
            required: true,
            schema: { type: 'integer', minimum: 1 },
          }],
        },
      },
    });
    const fetch = (async (input) => {
      const url = String(input);
      if (url === 'https://opabinia.cambrian.network/openapi.json') {
        return new Response(JSON.stringify(document), { status: 200 });
      }
      if (url === 'https://docs.cambrian.org/llms.txt') {
        return new Response('', { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof globalThis.fetch;

    const result = await loadRuntimeMetadataGroup(
      'base',
      testRuntime(fetch, cacheRoot),
      { refresh: true, now: 1_000 },
    );

    expect(result.metadata.cliDefaults).toEqual({
      'aero-v2-pool': { apr_days_annualized: '30' },
    });
    expect(result.metadata.spec['aero-v2-pool'].params.apr_days_annualized)
      .toMatchObject({ required: true, type: 'integer', min: 1, strict: true });
  });

  it('drops a CLI compatibility default when active OpenAPI rejects it', async () => {
    const cacheRoot = temporaryCacheRoot();
    const document = openApi({
      '/api/v1/evm/aero/v2/pool': {
        get: {
          parameters: [{
            name: 'apr_days_annualized',
            in: 'query',
            required: true,
            schema: { type: 'integer', minimum: 1, maximum: 29 },
          }],
        },
      },
    });
    const fetch = (async (input) => {
      const url = String(input);
      if (url === 'https://opabinia.cambrian.network/openapi.json') {
        return new Response(JSON.stringify(document), { status: 200 });
      }
      if (url === 'https://docs.cambrian.org/llms.txt') {
        return new Response('', { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof globalThis.fetch;

    const result = await loadRuntimeMetadataGroup(
      'base',
      testRuntime(fetch, cacheRoot),
      { refresh: true, now: 1_000 },
    );

    expect(result.metadata.cliDefaults).toEqual({});
  });

  it('lets an OpenAPI default replace a CLI compatibility default', async () => {
    const cacheRoot = temporaryCacheRoot();
    const document = openApi({
      '/api/v1/evm/aero/v2/pool': {
        get: {
          parameters: [{
            name: 'apr_days_annualized',
            in: 'query',
            required: true,
            schema: { type: 'integer', minimum: 1, maximum: 30, default: 7 },
          }],
        },
      },
    });
    const fetch = (async (input) => {
      const url = String(input);
      if (url === 'https://opabinia.cambrian.network/openapi.json') {
        return new Response(JSON.stringify(document), { status: 200 });
      }
      if (url === 'https://docs.cambrian.org/llms.txt') {
        return new Response('', { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof globalThis.fetch;

    const result = await loadRuntimeMetadataGroup(
      'base',
      testRuntime(fetch, cacheRoot),
      { refresh: true, now: 1_000 },
    );

    expect(result.metadata.cliDefaults).toEqual({});
    expect(result.metadata.spec['aero-v2-pool'].params.apr_days_annualized.default).toBe(7);
  });

  it('uses bundled public visibility when llms.txt cannot be fetched without a cache', async () => {
    const cacheRoot = temporaryCacheRoot();
    const fetch = (async (input) => {
      const url = String(input);
      if (url === 'https://deep42.cambrian.network/openapi.json') {
        return new Response(JSON.stringify(deep42Document()), { status: 200 });
      }
      throw new Error('docs unavailable');
    }) as typeof globalThis.fetch;

    const result = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(fetch, cacheRoot),
      { refresh: true, now: 1_000 },
    );
    expect(result.status.source).toBe('live');
    expect(result.status.visibilityMode).toBe('llms-filtered');
    expect(result.status.warning).toContain('docs unavailable');
    expect(result.status.warning).toContain('bundled public endpoint inventory');
    expect(result.metadata.resources).toEqual([
      'social-data/alpha-tweet-detection',
      'social-data/influencer-credibility',
      'social-data/sentiment-shifts',
      'social-data/token-analysis',
      'social-data/trending-momentum',
    ]);
    expect(result.metadata.resources).not.toContain('social-data/new-signal');
  });

  it('ignores a structurally plausible cache whose discovered params are not strict', async () => {
    const cacheRoot = temporaryCacheRoot();
    const runtime = testRuntime((async () => {
      throw new Error('offline');
    }) as typeof globalThis.fetch, cacheRoot);
    const path = registryCachePath(runtime, 'deep42');
    mkdirSync(join(path, '..'), { recursive: true });
    const unsafeSpec = {
      'social-data/new-signal': {
        apiPath: '/api/v1/deep42/social-data/new-signal',
        method: 'GET',
        params: { limit: { required: false, type: 'integer' } },
      },
    };
    writeFileSync(path, JSON.stringify({
      version: REGISTRY_CACHE_VERSION,
      group: 'deep42',
      fetchedAt: 1_000,
      expiresAt: 2_000,
      compatibleSpec: unsafeSpec,
      visibleSpec: unsafeSpec,
      llmsEndpointKeys: [],
      rejected: [],
      visibilityMode: 'openapi-sparse',
      usableLlmsCount: 0,
      openapi: {},
      llms: {},
    }));

    const result = await loadRuntimeMetadataGroup('deep42', runtime, {
      offline: true,
      now: 1_500,
    });
    expect(result.status.source).toBe('bundle');
    expect(result.metadata.resources).not.toContain('social-data/new-signal');
  });

  it('removes a previously cached addition when authoritative OpenAPI removes it', async () => {
    const cacheRoot = temporaryCacheRoot();
    const runtime = testRuntime(schemaFetch(deep42Document()), cacheRoot);
    await loadRuntimeMetadataGroup('deep42', runtime, { refresh: true, now: 1_000 });

    const withoutAddition = openApi({
      '/api/v1/deep42/social-data/alpha-tweet-detection': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/influencer-credibility': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/sentiment-shifts': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/token-analysis': { get: { parameters: [] } },
    });
    const refreshed = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(withoutAddition), cacheRoot),
      { refresh: true, now: 2_000 },
    );
    expect(refreshed.metadata.resources).not.toContain('social-data/new-signal');
    expect(refreshed.status.missingLiveAdditions).toEqual(['social-data/new-signal']);
    expect(refreshed.status.driftedLiveAdditions).toEqual([]);
  });

  it('replaces a cached runtime addition when authoritative OpenAPI changes it', async () => {
    const cacheRoot = temporaryCacheRoot();
    await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(deep42Document()), cacheRoot),
      { refresh: true, now: 1_000 },
    );

    const changed = openApi({
      '/api/v1/deep42/social-data/alpha-tweet-detection': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/influencer-credibility': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/sentiment-shifts': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/token-analysis': { get: { parameters: [] } },
      '/api/v1/deep42/social-data/new-signal': {
        get: {
          parameters: [{
            name: 'limit',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          }],
        },
      },
    });
    const refreshed = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(changed), cacheRoot),
      { refresh: true, now: 2_000 },
    );

    expect(refreshed.status.missingLiveAdditions).toEqual([]);
    expect(refreshed.status.driftedLiveAdditions).toEqual(['social-data/new-signal']);
    expect(refreshed.metadata.spec['social-data/new-signal'].params.limit.type).toBe('string');
    expect(refreshed.metadata.spec['social-data/new-signal'].params.limit.required).toBe(true);
  });

  it('revalidates with ETags and reuses normalized cache on 304 responses', async () => {
    const cacheRoot = temporaryCacheRoot();
    await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(schemaFetch(deep42Document()), cacheRoot),
      { refresh: true, now: 1_000 },
    );
    const conditionalHeaders: string[] = [];
    const notModified = (async (_input, init) => {
      conditionalHeaders.push(new Headers(init?.headers).get('If-None-Match') ?? '');
      return new Response(null, { status: 304 });
    }) as typeof globalThis.fetch;
    const result = await loadRuntimeMetadataGroup(
      'deep42',
      testRuntime(notModified, cacheRoot),
      { refresh: true, now: 2_000 },
    );
    expect(result.status.source).toBe('live');
    expect(result.metadata.resources).toContain('social-data/new-signal');
    expect(conditionalHeaders).toEqual(expect.arrayContaining(['"deep42-v1"', '"docs-v1"']));
  });

  it('can clear one group cache without changing the bundled registry', async () => {
    const cacheRoot = temporaryCacheRoot();
    const runtime = testRuntime(schemaFetch(deep42Document()), cacheRoot);
    await loadRuntimeMetadataGroup('deep42', runtime, { refresh: true, now: 1_000 });
    expect(clearRegistryCache(runtime, 'deep42')).toBe(1);
    const bundled = await loadRuntimeMetadataGroup('deep42', runtime, {
      offline: true,
      now: 2_000,
    });
    expect(bundled.status.source).toBe('bundle');
    expect(bundled.metadata.resources).not.toContain('social-data/new-signal');
  });
});
