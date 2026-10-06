/**
 * Proves OpenAPI is the runtime source of truth: endpoints and chains that the
 * live document advertises become usable without rebuilding or reinstalling the
 * CLI. Curated chains keep friendly tokens; any other advertised chain id is
 * exposed as a deterministic \`chain-<id>\` command.
 *
 * All fetch mocks are injected - no live network calls.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runCli } from '../src/cli/index.js';
import { loadRuntimeMetadataGroup } from '../src/schema/registry.js';
import { createRuntime } from '../src/cli/core.js';

function cacheRoot(): string {
  return mkdtempSync(join(tmpdir(), 'cambrian-chain-auto-'));
}

interface Harness {
  fetch: typeof globalThis.fetch;
  requests: string[];
}

interface HarnessOptions {
  /** OpenAPI `x-enum-varnames` for the chain_id enum. */
  enumNames?: string[];
  /** Rows served by `/evm/chains` as [id, name]. */
  chainsTable?: Array<[number, string]>;
}

/** EVM schema with a configurable chain enum and endpoint set. */
function evmHarness(
  chainIds: number[],
  extraPaths: string[] = [],
  documented = true,
  options: HarnessOptions = {},
): Harness {
  const chain = {
    name: 'chain_id',
    in: 'query',
    schema: {
      type: 'integer',
      enum: chainIds,
      default: 8453,
      ...(options.enumNames ? { 'x-enum-varnames': options.enumNames } : {}),
    },
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
    if (options.chainsTable && url.startsWith('https://api.cambrian.org/evm/chains')) {
      const table = {
        columns: [{ name: 'id', type: 'UInt32' }, { name: 'name', type: 'String' }],
        data: options.chainsTable,
        rows: options.chainsTable.length,
      };
      return new Response(JSON.stringify([table]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
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
  env: Record<string, string> = { CAMBRIAN_API_KEY: 'test-key' },
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, {
    fetch,
    stdout: (line) => { stdout += `${line}\n`; },
    stderr: (line) => { stderr += `${line}\n`; },
    env: { ...env, XDG_CACHE_HOME: root },
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
    // The chain group pins chain_id, so the contract names it instead of listing it.
    expect(endpointDocs.stdout).toContain('Set by the command group: chain_id.');
    expect(endpointDocs.stdout).not.toContain('--chain-id');

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

describe('API-named chains without a CLI release', () => {
  const chainsCalls = (requests: string[]) =>
    requests.filter((url) => url.startsWith('https://api.cambrian.org/evm/chains')).length;

  it('F. OpenAPI x-enum-varnames names a new chain everywhere; chain-<id> stays an alias', async () => {
    const root = cacheRoot();
    const { fetch, requests } = evmHarness([1, 8453, 42161, 10143], [], true, {
      enumNames: ['ethereum', 'base', 'arbitrum', 'monad'],
    });

    const root_help = await run(['--help'], fetch, root);
    expect(root_help.stdout).toContain('cambrian monad <resource> [options]');
    expect(root_help.stdout).toContain('Monad DeFi data');

    const call = await run(['monad', 'tokens', '--limit', '1'], fetch, root);
    expect(call.code).toBe(0);
    expect(requests.at(-1)).toContain('chain_id=10143');

    const alias = await run(['chain-10143', 'tokens', '--limit', '1'], fetch, root);
    expect(alias.code).toBe(0);
    expect(requests.at(-1)).toContain('chain_id=10143');

    const report = JSON.parse((await run(['schema', 'chains'], fetch, root)).stdout);
    expect(report.chains.find((entry: { chainId: number }) => entry.chainId === 10143))
      .toMatchObject({ command: 'monad', alias: 'chain-10143', label: 'Monad', source: 'discovered' });

    expect((await run(['__complete', 'mon'], fetch, root)).stdout).toContain('monad');
    expect((await run(['docs', 'monad', 'tokens', '--offline'], fetch, root)).stdout)
      .toContain('# cambrian monad tokens');
    // The OpenAPI already names every chain, so /evm/chains is never called.
    expect(chainsCalls(requests)).toBe(0);

    rmSync(root, { recursive: true, force: true });
  });

  it('G. /evm/chains names an unnamed chain once per TTL when an API key exists', async () => {
    const root = cacheRoot();
    const { fetch, requests } = evmHarness([1, 8453, 42161, 4663, 10143], [], true, {
      chainsTable: [[1, 'ethereum'], [8453, 'base'], [42161, 'arbitrum'], [4663, 'robinhood'], [10143, 'monad']],
    });

    const call = await run(['monad', 'tokens', '--limit', '1'], fetch, root);
    expect(call.code).toBe(0);
    expect(requests.at(-1)).toContain('chain_id=10143');
    expect((await run(['base', '--help'], fetch, root)).code).toBe(0);
    expect(chainsCalls(requests)).toBe(1);

    // A forced refresh asks again.
    expect((await run(['schema', 'refresh', 'base'], fetch, root)).code).toBe(0);
    expect(chainsCalls(requests)).toBe(2);

    rmSync(root, { recursive: true, force: true });
  });

  it('H. without an API key the chain stays chain-<id> and /evm/chains is not called', async () => {
    const root = cacheRoot();
    const { fetch, requests } = evmHarness([1, 8453, 42161, 10143], [], true, {
      chainsTable: [[10143, 'monad']],
    });

    const help = await run(['--help'], fetch, root, {});
    expect(help.stdout).toContain('cambrian chain-10143 <resource>');
    expect(help.stdout).not.toContain('cambrian monad');
    expect(chainsCalls(requests)).toBe(0);

    rmSync(root, { recursive: true, force: true });
  });

  it('I. unsafe or clashing names fall back to chain-<id>', async () => {
    const root = cacheRoot();
    const { fetch } = evmHarness([8453, 10, 11, 12, 13, 14], [], true, {
      enumNames: ['base', 'solana', 'base', 'bad name!', 'chain-99', 'Arbitrum Nova'],
    });

    const report = JSON.parse((await run(['schema', 'chains'], fetch, root)).stdout);
    const commandFor = (id: number) =>
      report.chains.find((entry: { chainId: number }) => entry.chainId === id)?.command;
    expect(commandFor(10)).toBe('chain-10'); // reserved top-level command
    expect(commandFor(11)).toBe('chain-11'); // curated token of another chain
    expect(commandFor(12)).toBe('bad-name'); // slugged into a safe token
    expect(commandFor(13)).toBe('chain-13'); // would shadow the alias space
    expect(commandFor(14)).toBe('arbitrum-nova');
    expect(report.chains.find((entry: { chainId: number }) => entry.chainId === 14).label)
      .toBe('Arbitrum Nova');

    rmSync(root, { recursive: true, force: true });
  });
});

describe('pinned --chain-id on chain command groups', () => {
  it('J. is hidden from help and completion but the matching value still works', async () => {
    const root = cacheRoot();
    const { fetch, requests } = evmHarness([1, 8453, 42161]);

    const help = await run(['arbitrum', 'tokens', '--help'], fetch, root);
    expect(help.stdout).not.toContain('--chain-id');
    expect(help.stdout).toContain('Other chains: replace "arbitrum" with base or ethereum.');

    const completion = await run(['__complete', 'arbitrum', 'tokens', '--'], fetch, root);
    expect(completion.stdout).not.toContain('--chain-id');
    expect(completion.stdout).toContain('--limit');

    const same = await run(['arbitrum', 'tokens', '--chain-id', '42161', '--limit', '1'], fetch, root);
    expect(same.code).toBe(0);
    expect(requests.at(-1)).toContain('chain_id=42161');

    rmSync(root, { recursive: true, force: true });
  });

  it('K. a different value names the right command, or lists where the endpoint runs', async () => {
    const root = cacheRoot();
    const { fetch, requests } = evmHarness([1, 8453]);
    const before = requests.filter((url) => url.includes('/evm/tokens?')).length;

    const other = await run(['base', 'tokens', '--chain-id', '1'], fetch, root);
    expect(other.code).toBe(2);
    expect(other.stderr).toContain('--chain-id 1 does not match "base" (chain 8453).');
    expect(other.stderr).toContain('Use: cambrian ethereum tokens');

    const unknown = await run(['base', 'tokens', '--chain-id', '7'], fetch, root);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('tokens is also available on: ethereum.');

    expect(requests.filter((url) => url.includes('/evm/tokens?'))).toHaveLength(before);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('review regressions', () => {
  afterEach(() => { vi.useRealTimers(); });

  /** Schema whose chain enum can change between runs, with /evm/chains naming 10143. */
  function mutableHarness(initial: number[]) {
    const state = { chainIds: initial };
    const requests: string[] = [];
    const fetch = (async (input: unknown) => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://api.cambrian.org/evm/openapi.json') {
        const chain = { name: 'chain_id', in: 'query', schema: { type: 'integer', enum: state.chainIds, default: 8453 } };
        const paths = { '/evm/tokens': { get: { parameters: [chain] } } };
        return new Response(JSON.stringify({ openapi: '3.1.0', info: { title: 'EVM', version: String(state.chainIds) }, paths }));
      }
      if (url === 'https://docs.cambrian.org/llms.txt') return new Response('- GET /evm/tokens');
      if (url.startsWith('https://api.cambrian.org/evm/chains')) {
        const table = { columns: [{ name: 'id' }, { name: 'name' }], data: [[10143, 'monad']], rows: 1 };
        return new Response(JSON.stringify([table]), { headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('https://api.cambrian.org/evm/')) {
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof globalThis.fetch;
    return { state, requests, fetch };
  }

  it('L. a named chain dropped after a refresh errors instead of querying Base', async () => {
    const root = cacheRoot();
    const { state, requests, fetch } = mutableHarness([8453, 10143]);
    expect((await run(['monad', 'tokens'], fetch, root)).code).toBe(0);
    expect(requests.at(-1)).toContain('chain_id=10143');

    // The schema drops 10143; the cache still names monad until it expires.
    state.chainIds = [8453];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    const dropped = await run(['monad', 'tokens'], fetch, root);
    expect(dropped.code).toBe(2);
    expect(dropped.stderr).toContain('monad is not advertised by the active EVM schema');
    expect(requests.some((url) => url.includes('/evm/tokens?chain_id=8453'))).toBe(false);

    const docs = await run(['docs', 'monad', 'tokens'], fetch, root);
    // Treated like any unknown docs group (same as main), never as Base docs.
    expect(docs.stdout).not.toContain('# cambrian monad tokens');
    expect(docs.stdout).not.toContain('Authoritative executable contract');
    rmSync(root, { recursive: true, force: true });
  });

  it('M. a typo of a known command stays offline', async () => {
    const root = cacheRoot();
    const { requests, fetch } = mutableHarness([8453]);
    const typo = await run(['solan'], fetch, root);
    expect(typo.code).toBe(2);
    expect(typo.stderr).toContain('Did you mean "solana"');
    expect(requests).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it('N. --base-url never fetches or caches /evm/chains names', async () => {
    const root = cacheRoot();
    const { requests, fetch } = mutableHarness([8453, 10143]);
    await run(['chain-10143', 'tokens', '--base-url', 'https://api.cambrian.org'], fetch, root);
    expect(requests.some((url) => url.includes('/evm/chains'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('O. library metadata does not depend on the CLI names cache', async () => {
    const root = cacheRoot();
    const { fetch } = mutableHarness([8453, 10143]);
    expect((await run(['monad', 'tokens'], fetch, root)).code).toBe(0); // CLI cached the name
    const runtime = createRuntime({ fetch, env: { XDG_CACHE_HOME: root }, homedir: () => root });
    const { metadata } = await loadRuntimeMetadataGroup('base', runtime);
    expect(metadata.chainNames).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });
});
