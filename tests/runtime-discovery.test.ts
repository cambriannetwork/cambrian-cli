import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli/index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function cacheRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cambrian-runtime-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

const llms = `
# Cambrian
- GET /api/v1/deep42/social-data/alpha-tweet-detection
- GET /api/v1/deep42/social-data/influencer-credibility
- GET /api/v1/deep42/social-data/sentiment-shifts
- GET /api/v1/deep42/social-data/token-analysis
`;

function deep42Schema(options: {
  includeNew?: boolean;
  driftTokenAnalysis?: boolean;
  modernTokenAnalysis?: boolean;
} = {}): unknown {
  const paths: Record<string, unknown> = {
    '/api/v1/deep42/social-data/alpha-tweet-detection': { get: { parameters: [] } },
    '/api/v1/deep42/social-data/influencer-credibility': { get: { parameters: [] } },
    '/api/v1/deep42/social-data/sentiment-shifts': { get: { parameters: [] } },
    '/api/v1/deep42/social-data/token-analysis': {
      get: {
        parameters: options.modernTokenAnalysis
          ? [{
              name: 'token_symbol',
              in: 'query',
              schema: { type: 'string' },
            }, {
              name: 'days_back',
              in: 'query',
              schema: { type: 'integer', default: 7, minimum: 1, maximum: 730 },
            }, {
              name: 'granularity',
              in: 'query',
              schema: { type: 'string', default: 'total', pattern: '^(total|[1-9][0-9]*[hd])$' },
            }]
          : options.driftTokenAnalysis
            ? [{ name: 'breaking_required', in: 'query', required: true, schema: { type: 'string' } }]
            : [],
      },
    },
    '/api/v1/deep42/social-data/trending-momentum': { get: { parameters: [] } },
  };
  if (options.includeNew) {
    paths['/api/v1/deep42/social-data/new-signal'] = {
      get: {
        parameters: [{
          name: 'limit',
          in: 'query',
          required: true,
          schema: { type: 'integer', minimum: 1, maximum: 10 },
        }, {
          name: 'mode',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['fast', 'full'], default: 'fast' },
        }],
      },
    };
  }
  return { openapi: '3.1.0', info: { title: 'Deep42', version: '1' }, paths };
}

function routedFetch(
  schema: unknown,
  requests: string[],
): typeof globalThis.fetch {
  return (async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://deep42.cambrian.network/openapi.json') {
      return new Response(JSON.stringify(schema), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"schema-v1"' },
      });
    }
    if (url === 'https://docs.cambrian.org/llms.txt') {
      return new Response(llms, { status: 200, headers: { etag: '"docs-v1"' } });
    }
    if (url.startsWith('https://deep42.cambrian.network/api/v1/deep42/')) {
      return new Response(JSON.stringify({ ok: true, url }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof globalThis.fetch;
}

async function run(
  argv: string[],
  fetch: typeof globalThis.fetch,
  root: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, {
    fetch,
    stdout: (line) => { stdout += `${line}\n`; },
    stderr: (line) => { stderr += `${line}\n`; },
    env: {
      CAMBRIAN_API_KEY: 'test-key',
      XDG_CACHE_HOME: root,
    },
    homedir: () => root,
  });
  return { code, stdout, stderr };
}

describe('runtime endpoint discovery through the CLI', () => {
  it('preserves the preflight auth failure without making schema requests', async () => {
    let fetches = 0;
    let stderr = '';
    const code = await runCli(['deep42', 'social-data/alpha-tweet-detection'], {
      fetch: (async () => {
        fetches += 1;
        throw new Error('must not fetch');
      }) as typeof globalThis.fetch,
      stdout: () => {},
      stderr: (line) => { stderr += `${line}\n`; },
      env: {},
      homedir: () => cacheRoot(),
    });

    expect(code).toBe(2);
    expect(stderr).toContain('API key required');
    expect(fetches).toBe(0);
  });

  it('preserves bundled pay validation before any schema or gateway request', async () => {
    let fetches = 0;
    let stderr = '';
    const root = cacheRoot();
    const code = await runCli(['pay', 'solana', 'holder-token-balances', '--yes'], {
      fetch: (async () => {
        fetches += 1;
        throw new Error('must not fetch');
      }) as typeof globalThis.fetch,
      stdout: () => {},
      stderr: (line) => { stderr += `${line}\n`; },
      env: {
        CAMBRIAN_X402_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
        XDG_CACHE_HOME: root,
      },
      homedir: () => root,
    });

    expect(code).toBe(2);
    expect(stderr).toContain('Missing required option --wallet-address');
    expect(fetches).toBe(0);
  });

  it('discovers and executes a new endpoint without a rebuilt snapshot', async () => {
    const root = cacheRoot();
    const requests: string[] = [];
    const fetch = routedFetch(deep42Schema({ includeNew: true }), requests);

    const result = await run(
      ['deep42', 'social-data/new-signal', '--limit', '2', '--json'],
      fetch,
      root,
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
    expect(requests).toContain('https://deep42.cambrian.network/openapi.json');
    expect(requests).toContain('https://docs.cambrian.org/llms.txt');
    expect(requests.some((url) =>
      url.endsWith('/social-data/new-signal?limit=2&mode=fast'))).toBe(true);

    const noNetwork = (async () => {
      throw new Error('completion and fresh cached help must not fetch');
    }) as typeof globalThis.fetch;
    const help = await run(['deep42', '--help'], noNetwork, root);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('social-data/new-signal');

    const completion = await run(['__complete', 'deep42', 'social-data/new'], noNetwork, root);
    expect(completion.code).toBe(0);
    expect(completion.stdout.trim()).toBe('social-data/new-signal');

    const opencli = await run(['describe', 'opencli', '--offline'], noNetwork, root);
    expect(opencli.code).toBe(0);
    const document = JSON.parse(opencli.stdout);
    const deep42 = document.commands.find((command: { name: string }) => command.name === 'deep42');
    expect(deep42.commands.some((command: { name: string }) =>
      command.name === 'social-data/new-signal')).toBe(true);

    const docs = await run(
      ['docs', 'deep42', 'social-data/new-signal', '--offline'],
      noNetwork,
      root,
    );
    expect(docs.code).toBe(0);
    expect(docs.stdout).toContain('GET /api/v1/deep42/social-data/new-signal');
    expect(docs.stdout).toContain('--limit');

    const pay = await run(
      ['pay', 'deep42', 'social-data/new-signal', '--limit', '2', '--offline'],
      noNetwork,
      root,
    );
    expect(pay.code).toBe(2);
    expect(pay.stderr).toContain('x402 payments need a wallet key');
    expect(pay.stderr).not.toContain('Unknown deep42 resource');
  });

  it('uses a changed live OpenAPI definition for an installed command', async () => {
    const root = cacheRoot();
    const requests: string[] = [];
    const result = await run(
      [
        'deep42',
        'social-data/token-analysis',
        '--breaking-required',
        'live-contract',
        '--json',
      ],
      routedFetch(deep42Schema({ driftTokenAnalysis: true }), requests),
      root,
    );

    expect(result.code).toBe(0);
    expect(requests.some((url) =>
      url.endsWith('/social-data/token-analysis?breaking_required=live-contract'))).toBe(true);
  });

  it('uses an updated existing-operation contract for x402 preflight validation', async () => {
    const root = cacheRoot();
    const requests: string[] = [];
    const fetch = routedFetch(deep42Schema({ driftTokenAnalysis: true }), requests);
    const refreshed = await run(['schema', 'refresh', 'deep42'], fetch, root);
    expect(refreshed.code).toBe(0);

    const noNetwork = (async () => {
      throw new Error('invalid pay preflight must not fetch');
    }) as typeof globalThis.fetch;
    const pay = await run([
      'pay',
      'deep42',
      'social-data/token-analysis',
      '--offline',
    ], noNetwork, root);

    expect(pay.code).toBe(2);
    expect(pay.stderr).toContain('Missing required option --breaking-required');
  });

  it('adapts token-analysis validation, help, and flags to the current OpenAPI contract', async () => {
    const root = cacheRoot();
    const requests: string[] = [];
    const fetch = routedFetch(deep42Schema({ modernTokenAnalysis: true }), requests);

    const result = await run([
      'deep42',
      'social-data/token-analysis',
      '--token-symbol',
      'SOL',
      '--days-back',
      '31',
      '--granularity',
      '4h',
      '--json',
    ], fetch, root);

    expect(result.code).toBe(0);
    expect(requests.some((url) => url.endsWith(
      '/social-data/token-analysis?token_symbol=SOL&days_back=31&granularity=4h',
    ))).toBe(true);

    const noNetwork = (async () => {
      throw new Error('fresh cached help must not fetch');
    }) as typeof globalThis.fetch;
    const help = await run([
      'deep42',
      'social-data/token-analysis',
      '--help',
    ], noNetwork, root);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('--days-back (default: 7, 1-730)');
    expect(help.stdout).toContain('--granularity (default: total)');
    expect(help.stdout).toContain(
      'CLI validation enforces these active OpenAPI constraints before sending a request.',
    );
    expect(help.stdout).toContain(
      'Structural fields (required/default/enum/pattern/range) take precedence over descriptive prose.',
    );
    expect(help.stdout).not.toContain('--include-price-correlation');

    const outOfRange = await run([
      'deep42',
      'social-data/token-analysis',
      '--days-back',
      '731',
      '--offline',
    ], noNetwork, root);
    expect(outOfRange.code).toBe(2);
    expect(outOfRange.stderr).toContain('--days-back must be at most 730');

    const removedFlag = await run([
      'deep42',
      'social-data/token-analysis',
      '--include-price-correlation',
      'true',
      '--offline',
    ], noNetwork, root);
    expect(removedFlag.code).toBe(2);
    expect(removedFlag.stderr).toContain('--include-price-correlation');
  });

  it('keeps bundled commands working in offline mode without schema traffic', async () => {
    const root = cacheRoot();
    const requests: string[] = [];
    const fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('openapi.json') || url.includes('llms.txt')) {
        throw new Error('schema network must be disabled');
      }
      return new Response(JSON.stringify([{ ok: true }]), { status: 200 });
    }) as typeof globalThis.fetch;

    const result = await run(
      ['deep42', 'social-data/alpha-tweet-detection', '--limit', '1', '--offline', '--json'],
      fetch,
      root,
    );
    expect(result.code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('/social-data/alpha-tweet-detection?limit=1');
  });

  it('keeps unsupported new operations hidden after a forced refresh', async () => {
    const root = cacheRoot();
    const requests: string[] = [];
    const schema = {
      openapi: '3.1.0',
      info: { title: 'Deep42', version: '1' },
      paths: {
        '/api/v1/deep42/social-data/new-post': {
          post: { parameters: [] },
        },
      },
    };
    const result = await run(
      ['deep42', 'social-data/new-post'],
      routedFetch(schema, requests),
      root,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown deep42 resource');
    expect(requests).toContain('https://deep42.cambrian.network/openapi.json');
  });

  it('exposes refresh, status, and clear-cache schema controls', async () => {
    const root = cacheRoot();
    const requests: string[] = [];
    const refreshed = await run(
      ['schema', 'refresh', 'deep42'],
      routedFetch(deep42Schema({ includeNew: true }), requests),
      root,
    );
    expect(refreshed.code).toBe(0);
    const refreshStatus = JSON.parse(refreshed.stdout);
    expect(refreshStatus.group).toBe('deep42');
    expect(refreshStatus.source).toBe('live');
    expect(refreshStatus.additions).toContain('social-data/new-signal');

    const noNetwork = (async () => {
      throw new Error('status and clear-cache must not fetch');
    }) as typeof globalThis.fetch;
    const status = await run(['schema', 'status', 'deep42'], noNetwork, root);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ group: 'deep42', source: 'cache' });

    const offlineStatus = await run(
      ['--offline', 'schema', 'status', 'deep42'],
      noNetwork,
      root,
    );
    expect(offlineStatus.code).toBe(0);
    expect(JSON.parse(offlineStatus.stdout)).toMatchObject({
      group: 'deep42',
      source: 'cache',
    });

    const cleared = await run(['schema', 'clear-cache', 'deep42'], noNetwork, root);
    expect(cleared.code).toBe(0);
    expect(JSON.parse(cleared.stdout)).toMatchObject({ cleared: 1, group: 'deep42' });

    const bundled = await run(['schema', 'status', 'deep42'], noNetwork, root);
    expect(JSON.parse(bundled.stdout)).toMatchObject({ group: 'deep42', source: 'bundle' });
  });

  it('returns a failing status when a forced schema refresh has no fallback cache', async () => {
    const root = cacheRoot();
    const unavailable = (async () => {
      throw new Error('registry unavailable');
    }) as typeof globalThis.fetch;

    const result = await run(['schema', 'refresh', 'deep42'], unavailable, root);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      group: 'deep42',
      source: 'bundle',
      lastError: 'registry unavailable',
    });
  });

  it('completes schema controls and offers offline mode for data commands', async () => {
    const root = cacheRoot();
    const noNetwork = (async () => {
      throw new Error('completion must not fetch');
    }) as typeof globalThis.fetch;

    const schema = await run(['__complete', 'schema', 're'], noNetwork, root);
    expect(schema.stdout.trim()).toBe('refresh');
    const group = await run(['__complete', 'schema', 'status', 'de'], noNetwork, root);
    expect(group.stdout.trim()).toBe('deep42');
    const flags = await run([
      '__complete',
      'deep42',
      'social-data/alpha-tweet-detection',
      '--off',
    ], noNetwork, root);
    expect(flags.stdout.trim()).toBe('--offline');
  });
});
