/**
 * Proves OpenAPI is the runtime source of truth: endpoints and chains that the
 * live document advertises become usable without rebuilding or reinstalling the
 * CLI. Curated chains keep friendly tokens; any other advertised chain id is
 * exposed as a deterministic \`chain-<id>\` command.
 *
 * All fetch mocks are injected - no live network calls.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runCli } from '../src/cli/index.js';

function cacheRoot(): string {
  return mkdtempSync(join(tmpdir(), 'cambrian-chain-auto-'));
}

interface Harness {
  fetch: typeof globalThis.fetch;
  requests: string[];
}

/** EVM schema with a configurable chain enum and endpoint set. */
function evmHarness(chainIds: number[], extraPaths: string[] = [], documented = true): Harness {
  const chain = {
    name: 'chain_id',
    in: 'query',
    schema: { type: 'integer', enum: chainIds, default: 8453 },
  };
  const limit = {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', default: 100, minimum: 1 },
  };
  const paths: Record<string, unknown> = {
    '/evm/chains': { get: { parameters: [] } },
    '/evm/tokens': { get: { parameters: [chain, limit] } },
  };
  for (const path of extraPaths) paths[path] = { get: { parameters: [chain, limit] } };
  const schema = { openapi: '3.1.0', info: { title: 'EVM', version: '1' }, paths };
  const documentedText = documented
    ? Object.keys(paths).map((path) => `- GET ${path}`).join('\n')
    : '# no matching endpoints';
  const requests: string[] = [];
  const fetch = (async (input: unknown) => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://api.cambrian.org/evm/openapi.json') {
      return new Response(JSON.stringify(schema), { status: 200 });
    }
    if (url === 'https://docs.cambrian.org/llms.txt') {
      return new Response(documentedText, { status: 200 });
    }
    if (url.startsWith('https://api.cambrian.org/evm/')) {
      return new Response(JSON.stringify({ ok: true, url }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
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
    env: { CAMBRIAN_API_KEY: 'test-key', XDG_CACHE_HOME: root },
    homedir: () => root,
  });
  return { code, stdout, stderr };
}

describe('runtime EVM discovery without a rebuild', () => {
  it('A. a brand-new endpoint appears for a curated chain immediately', async () => {
    const root = cacheRoot();
    const { fetch } = evmHarness([1, 8453, 42161], ['/evm/brand-new-revenue']);

    const help = await run(['base', '--help'], fetch, root);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('brand-new-revenue');

    const call = await run(['base', 'brand-new-revenue', '--limit', '1'], fetch, root);
    expect(call.code).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  it('B. a brand-new chain id is usable as chain-<id> with no rebuild', async () => {
    const root = cacheRoot();
    const { fetch, requests } = evmHarness([1, 8453, 42161, 10]);

    const help = await run(['chain-10', '--help'], fetch, root);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('tokens');

    const call = await run(['chain-10', 'tokens', '--limit', '1'], fetch, root);
    expect(call.code).toBe(0);
    expect(requests.at(-1)).toContain('chain_id=10');

    rmSync(root, { recursive: true, force: true });
  });

  it('C. chain-<id> is rejected cleanly when the schema does not advertise it', async () => {
    const root = cacheRoot();
    const { fetch, requests } = evmHarness([1, 8453, 42161]);
    const before = requests.length;

    const result = await run(['chain-10', 'tokens'], fetch, root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Chain 10 is not advertised by the active EVM schema');
    expect(requests.slice(before).some((url) => url.includes('/evm/tokens?'))).toBe(false);

    rmSync(root, { recursive: true, force: true });
  });

  it('D. discovered chains surface in schema chains, OpenCLI, completion, and docs', async () => {
    const root = cacheRoot();
    const { fetch } = evmHarness([1, 8453, 42161, 10]);

    const chains = await run(['schema', 'chains'], fetch, root);
    const report = JSON.parse(chains.stdout);
    const discovered = report.chains.find((entry: { chainId: number }) => entry.chainId === 10);
    expect(discovered).toMatchObject({ command: 'chain-10', source: 'discovered', supported: true });

    const opencli = await run(['describe', 'opencli', '--offline'], fetch, root);
    const document = JSON.parse(opencli.stdout);
    expect(document.commands.map((entry: { name: string }) => entry.name)).toContain('chain-10');
    expect(document.commands.find((entry: { name: string }) => entry.name === 'pay').commands
      .map((entry: { name: string }) => entry.name)).toContain('chain-10');

    const completion = await run(['__complete', 'chain-'], fetch, root);
    expect(completion.stdout).toContain('chain-10');

    const docs = await run(['docs', 'chain-10', '--offline'], fetch, root);
    expect(docs.code).toBe(0);
    expect(docs.stdout).toContain('tokens');
    const endpointDocs = await run(['docs', 'chain-10', 'tokens', '--offline'], fetch, root);
    expect(endpointDocs.stdout).toContain('# cambrian chain-10 tokens');
    expect(endpointDocs.stdout).toContain('default: 10');
    expect(endpointDocs.stdout).toContain('range 10-10');

    rmSync(root, { recursive: true, force: true });
  });

  it('E. curated chains are unaffected by discovery', async () => {
    const root = cacheRoot();
    const { fetch, requests } = evmHarness([1, 8453, 42161]);

    expect((await run(['arbitrum', 'tokens', '--limit', '1'], fetch, root)).code).toBe(0);
    expect(requests.at(-1)).toContain('chain_id=42161');

    // No synthetic duplicate for an id that already has a curated row.
    const chains = await run(['schema', 'chains'], fetch, root);
    const report = JSON.parse(chains.stdout);
    expect(report.chains.filter((entry: { chainId: number }) => entry.chainId === 42161))
      .toHaveLength(1);
    expect(report.chains.some((entry: { command: string }) => entry.command === 'chain-42161')).toBe(false);

    rmSync(root, { recursive: true, force: true });
  });
});
