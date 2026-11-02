import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli/index.js';
import { deep42AcceptHeader } from '../src/client/index.js';
import { versionHelpNotes } from '../src/cli/deep42-handlers.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function cacheRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cambrian-api-version-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

const PATH = '/deep42/social-data/influencer-credibility';
const VERSIONS = {
  versions: [
    { version: '5.0.0', is_default: false, becomes_default_at: '2099-11-27T23:08:15+00:00' },
    { version: '4.1.0', is_default: false, becomes_default_at: '2099-11-06T14:08:47+00:00' },
    { version: '4.0.0', is_default: true, becomes_default_at: '2026-09-08T00:00:00+00:00' },
    { version: '3.0.0', is_default: false },
  ],
  default_version: '4.0.0',
};

function schema(version?: string): unknown {
  const parameters = [
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
    { name: 'sort_by', in: 'query', schema: { type: 'string', enum: ['return_vs_bitcoin', 'reach'] } },
    ...(version === '4.1.0'
      ? [
          { name: 'handle', in: 'query', schema: { type: 'string' } },
          { name: 'include_calls', in: 'query', schema: { type: 'boolean' } },
        ]
      : []),
  ];
  return {
    openapi: '3.1.0',
    info: { title: 'Deep42', version: '1' },
    paths: { [PATH]: { get: { parameters, 'x-available-versions': VERSIONS } } },
  };
}

interface Recorded { url: string; accept: string | null }

function fakeApi(requests: Recorded[]): typeof globalThis.fetch {
  return (async (input, init) => {
    const url = String(input);
    requests.push({ url, accept: new Headers(init?.headers).get('Accept') });
    if (url === 'https://api.cambrian.org/deep42/openapi.json') {
      return new Response(JSON.stringify(schema()), { status: 200 });
    }
    if (url === 'https://api.cambrian.org/deep42/openapi.json?version=4.1.0') {
      return new Response(JSON.stringify(schema('4.1.0')), { status: 200 });
    }
    if (url === 'https://docs.cambrian.org/llms.txt') {
      return new Response(`- GET /api/v1${PATH}`, { status: 200 });
    }
    if (url.startsWith(`https://api.cambrian.org${PATH}?`)) {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof globalThis.fetch;
}

async function run(argv: string[], fetch: typeof globalThis.fetch) {
  const root = cacheRoot();
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, {
    fetch,
    stdout: (line) => { stdout += `${line}\n`; },
    stderr: (line) => { stderr += `${line}\n`; },
    env: { CAMBRIAN_API_KEY: 'test-key', XDG_CACHE_HOME: root },
    homedir: () => root,
  });
  return { code, stdout, stderr };
}

describe('deep42 --api-version', () => {
  it('builds the Accept header that selects one version', () => {
    expect(deep42AcceptHeader(`/api/v1${PATH}`, '4.1.0')).toBe(
      'application/vnd.cambrian.deep42.social-data.influencer-credibility.v4.1.0+json',
    );
    expect(deep42AcceptHeader(`${PATH}/?limit=1`, '4.1.0')).toBe(
      'application/vnd.cambrian.deep42.social-data.influencer-credibility.v4.1.0+json',
    );
  });

  it('treats a version past its date as the default when the cached schema is older', () => {
    const entry = {
      apiPath: PATH,
      method: 'GET',
      params: {},
      versions: [
        { version: '5.0.0', isDefault: false, becomesDefaultAt: '2026-11-27T00:00:00Z' },
        { version: '4.1.0', isDefault: false, becomesDefaultAt: '2026-11-06T00:00:00Z' },
        { version: '4.0.0', isDefault: true },
      ],
    };
    const [text] = versionHelpNotes(entry, undefined, Date.parse('2026-11-10T00:00:00Z'));
    expect(text).toContain('  4.1.0  default: used when --api-version is not set');
    expect(text).toContain('  5.0.0  queued: becomes the default on 2026-11-27');
    expect(text).toContain('  4.0.0  earlier versions');
  });

  it('help names the default version and the date each queued version becomes the default', async () => {
    const result = await run(['deep42', 'social-data/influencer-credibility', '--help'], fakeApi([]));

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('--handle');
    expect(result.stdout).toContain(
      [
        'API versions (select one with --api-version <version>):',
        '  4.0.0  default: used when --api-version is not set',
        '  4.1.0  queued: becomes the default on 2099-11-06',
        '  5.0.0  queued: becomes the default on 2099-11-27',
        '  3.0.0  earlier versions',
        'The options above are for the default version (4.0.0).',
      ].join('\n'),
    );
  });

  it('shows the options of the requested version', async () => {
    const result = await run(
      ['deep42', 'social-data/influencer-credibility', '--api-version', '4.1.0', '--help'],
      fakeApi([]),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--handle');
    expect(result.stdout).toContain('--include-calls');
    expect(result.stdout).toContain('The options above are for API version 4.1.0.');
  });

  it('accepts that version\'s options and sends its Accept header', async () => {
    const requests: Recorded[] = [];
    const result = await run(
      ['deep42', 'influencer-credibility', '--api-version', '4.1.0', '--handle', 'someone', '--include-calls'],
      fakeApi(requests),
    );

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const data = requests.find((r) => r.url.startsWith(`https://api.cambrian.org${PATH}?`));
    expect(data?.url).toContain('handle=someone');
    expect(data?.url).toContain('include_calls=true');
    expect(data?.accept).toBe(
      'application/vnd.cambrian.deep42.social-data.influencer-credibility.v4.1.0+json',
    );
  });

  it('sends no version header without --api-version and rejects options of other versions', async () => {
    const requests: Recorded[] = [];
    const ok = await run(['deep42', 'influencer-credibility', '--limit', '1'], fakeApi(requests));
    expect(ok.code).toBe(0);
    const data = requests.find((r) => r.url.startsWith(`https://api.cambrian.org${PATH}?`));
    expect(data?.accept).toBeNull();

    const rejected = await run(['deep42', 'influencer-credibility', '--handle', 'someone'], fakeApi([]));
    expect(rejected.code).toBe(2);
    expect(rejected.stderr).toContain('Unknown option for deep42 social-data/influencer-credibility: --handle.');
    expect(rejected.stderr).toContain('Another API version may offer it.');
  });

  it('rejects a version the endpoint does not offer before any data request', async () => {
    const requests: Recorded[] = [];
    const result = await run(
      ['deep42', 'influencer-credibility', '--api-version', '4.2.0'],
      fakeApi(requests),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      'does not offer API version 4.2.0. Offered versions: 5.0.0, 4.1.0, 4.0.0, 3.0.0.',
    );
    expect(requests.some((r) => r.url.startsWith(`https://api.cambrian.org${PATH}?`))).toBe(false);
  });

  it('rejects a partial version and --offline', async () => {
    const partial = await run(['deep42', 'influencer-credibility', '--api-version', '4.1'], fakeApi([]));
    expect(partial.code).toBe(2);
    expect(partial.stderr).toContain('--api-version must be a full version such as 4.1.0.');

    const offline = await run(
      ['deep42', 'influencer-credibility', '--api-version', '4.1.0', '--offline', '--help'],
      fakeApi([]),
    );
    expect(offline.code).toBe(2);
    expect(offline.stderr).toContain('Remove --offline');
  });
});
