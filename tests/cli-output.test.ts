/**
 * Integration tests for the Phase 2 opt-in data-path flags (--output / --fields
 * / --all / --max-items) driven through runCli with an injected fetch. Asserts
 * the default output is unchanged (regression) and the new formats/paging work.
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../src/cli/index.js';
import type { Runtime } from '../src/cli/core.js';

const TOKENS_TABLE = {
  columns: [
    { name: 'symbol', type: 'string' },
    { name: 'currentPriceUSD', type: 'number' },
    { name: 'volume', type: 'number' },
  ],
  data: [
    ['SOL', 150.25, 1000],
    ['USDC', 1.0, 5000],
  ],
  rows: 2,
};

function fetchJson(body: unknown): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof globalThis.fetch;
}

/** Serves synthetic TableResponse pages keyed off the URL's offset/limit. */
function fetchPaged(total: number): { fetch: typeof globalThis.fetch; getCalls: () => number } {
  let calls = 0;
  const fetch = (async (url: string) => {
    calls += 1;
    const u = new URL(url);
    const limit = Number(u.searchParams.get('limit') ?? '100');
    const offset = Number(u.searchParams.get('offset') ?? '0');
    const slice = Array.from({ length: total }, (_, i) => [i, `t${i}`]).slice(offset, offset + limit);
    return new Response(
      JSON.stringify({
        columns: [
          { name: 'idx', type: 'number' },
          { name: 'name', type: 'string' },
        ],
        data: slice,
        rows: slice.length,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, getCalls: () => calls };
}

function run(
  argv: string[],
  overrides: Partial<Runtime> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  return runCli(argv, {
    stdout: (line: string) => { stdout += line + '\n'; },
    stderr: (line: string) => { stderr += line + '\n'; },
    env: { CAMBRIAN_API_KEY: 'test-key', CAMBRIAN_SCHEMA_MODE: 'bundled' },
    ...overrides,
  }).then((code) => ({ code, stdout, stderr }));
}

describe('--output (opt-in; JSON stays default)', () => {
  it('default (no flag) is byte-identical pretty JSON', async () => {
    const { code, stdout } = await run(['solana', 'tokens'], { fetch: fetchJson(TOKENS_TABLE) });
    expect(code).toBe(0);
    expect(stdout.trimEnd()).toBe(JSON.stringify(TOKENS_TABLE, null, 2));
  });

  it('--output table renders an aligned table', async () => {
    const { code, stdout } = await run(['solana', 'tokens', '--output', 'table'], {
      fetch: fetchJson(TOKENS_TABLE),
    });
    expect(code).toBe(0);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toBe('symbol  currentPriceUSD  volume');
    expect(lines[1]).toMatch(/^─+/);
    expect(lines[2]).toContain('SOL');
  });

  it('--output tsv renders tab-separated rows', async () => {
    const { code, stdout } = await run(['solana', 'tokens', '--output', 'tsv'], {
      fetch: fetchJson(TOKENS_TABLE),
    });
    expect(code).toBe(0);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toBe('symbol\tcurrentPriceUSD\tvolume');
    expect(lines[1]).toBe('SOL\t150.25\t1000');
  });

  it('--output table on non-tabular data falls back to JSON (never errors)', async () => {
    const richObject = { answer: 'hello', sources: [{ id: 1 }] };
    const { code, stdout } = await run(
      ['deep42', 'social-data/token-analysis', '--output', 'table'],
      { fetch: fetchJson(richObject) },
    );
    expect(code).toBe(0);
    expect(stdout.trimEnd()).toBe(JSON.stringify(richObject, null, 2));
  });

  it('rejects an invalid --output value with a usage error (exit 2)', async () => {
    const { code, stderr } = await run(['solana', 'tokens', '--output', 'yaml'], {
      fetch: fetchJson(TOKENS_TABLE),
    });
    expect(code).toBe(2);
    expect(stderr).toContain('--output must be one of');
  });
});

describe('--fields projection', () => {
  it('projects a TableResponse to the named columns', async () => {
    const { code, stdout } = await run(
      ['solana', 'tokens', '--fields', 'symbol,currentPriceUSD'],
      { fetch: fetchJson(TOKENS_TABLE) },
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.columns.map((c: { name: string }) => c.name)).toEqual(['symbol', 'currentPriceUSD']);
    expect(out.data).toEqual([
      ['SOL', 150.25],
      ['USDC', 1.0],
    ]);
  });

  it('errors on an unknown column (exit 2)', async () => {
    const { code, stderr } = await run(['solana', 'tokens', '--fields', 'symbol,bogus'], {
      fetch: fetchJson(TOKENS_TABLE),
    });
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown column');
  });
});

describe('--all auto-pagination', () => {
  it('merges all pages and respects --max-items', async () => {
    const { fetch, getCalls } = fetchPaged(1000);
    const { code, stdout } = await run(
      ['solana', 'tokens', '--all', '--max-items', '50', '--limit', '20'],
      { fetch },
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.rows).toBe(50);
    expect(out.data.at(-1)[0]).toBe(49);
    expect(getCalls()).toBe(3); // 20 + 20 + 10
  });

  it('--all on a non-paginated resource (risk) is a usage error (exit 2)', async () => {
    const { code, stderr } = await run(['risk', 'perp-risk-engine', '--all'], {
      fetch: fetchJson({ status: 'ok' }),
    });
    expect(code).toBe(2);
    expect(stderr).toContain('--all is not supported');
  });

  it('--max-items without --all is a usage error (exit 2)', async () => {
    const { code, stderr } = await run(['solana', 'tokens', '--max-items', '10'], {
      fetch: fetchJson(TOKENS_TABLE),
    });
    expect(code).toBe(2);
    expect(stderr).toContain('--max-items requires --all');
  });
});
