/**
 * Integration tests for the Phase 2 opt-in data-path flags (--output / --fields
 * / --all / --max-items) driven through runCli with an injected fetch. Asserts
 * the default output is unchanged (regression) and the new formats/paging work.
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../src/cli/index.js';
import { coerceValue, patternChoices } from '../src/cli/dynamic-handler.js';
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
function fetchPaged(total: number): {
  fetch: typeof globalThis.fetch;
  getCalls: () => number;
  getLimits: () => number[];
} {
  let calls = 0;
  const limits: number[] = [];
  const fetch = (async (url: string) => {
    calls += 1;
    const u = new URL(url);
    const limit = Number(u.searchParams.get('limit') ?? '100');
    limits.push(limit);
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
  return { fetch, getCalls: () => calls, getLimits: () => limits };
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
  it('requests only the rows --max-items still needs', async () => {
    const { fetch, getCalls, getLimits } = fetchPaged(1000);
    const { code, stdout } = await run(['solana', 'tokens', '--all', '--max-items', '50'], { fetch });
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.rows).toBe(50);
    expect(out.data.at(-1)[0]).toBe(49);
    expect(getCalls()).toBe(1);
    expect(getLimits()).toEqual([50]);
  });

  it('uses the schema maximum page size, then only the remainder', async () => {
    const { fetch, getLimits } = fetchPaged(25000);
    const { code, stdout } = await run(['base', 'tokens', '--all', '--max-items', '12000'], { fetch });
    expect(code).toBe(0);
    expect(JSON.parse(stdout).rows).toBe(12000);
    expect(getLimits()).toEqual([10000, 2000]);
  });

  it('--limit with --all is a usage error sent before any request (exit 2)', async () => {
    const { fetch, getCalls } = fetchPaged(1000);
    const { code, stderr } = await run(['base', 'tokens', '--all', '--limit', '1', '--max-items', '2'], { fetch });
    expect(code).toBe(2);
    expect(stderr).toContain('--limit cannot be combined with --all');
    expect(getCalls()).toBe(0);
  });

  it.each(['2abc', '2.5', '0'])('--max-items %s is a usage error sent before any request', async (value) => {
    const { fetch, getCalls } = fetchPaged(1000);
    const { code, stderr } = await run(['base', 'tokens', '--all', '--max-items', value], { fetch });
    expect(code).toBe(2);
    expect(stderr).toContain('--max-items must be a positive integer.');
    expect(getCalls()).toBe(0);
  });

  it('--all=false is a usage error, not a request to paginate', async () => {
    const { fetch, getCalls } = fetchPaged(1000);
    const { code, stderr } = await run(['base', 'tokens', '--all=false'], { fetch });
    expect(code).toBe(2);
    expect(stderr).toContain('--all does not take a value.');
    expect(getCalls()).toBe(0);
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

/** Records every request URL and answers with a small TableResponse. */
function fetchRecording(): { fetch: typeof globalThis.fetch; urls: URL[] } {
  const urls: URL[] = [];
  const fetch = (async (url: string) => {
    urls.push(new URL(url));
    return new Response(JSON.stringify(TOKENS_TABLE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, urls };
}

describe('a flag without a value is a usage error, not the default', () => {
  it.each([
    [['base', 'tokens', '--limit']],
    [['base', 'tokens', '--limit=']],
    [['base', 'lending-morpho-markets', '--min-tvl-usd']],
    [['solana', 'tokens', '--limit', '--output', 'json']],
    [['deep42', 'social-data/alpha-tweet-detection', '--limit']],
    [['base', 'tokens', '--fields']],
  ])('%j exits 2 before any request', async (argv) => {
    const { fetch, urls } = fetchRecording();
    const { code, stderr } = await run(argv, { fetch });
    expect(code).toBe(2);
    expect(stderr).toContain('requires a value');
    expect(urls).toHaveLength(0);
  });

  it('pay rejects a missing value before any gateway request', async () => {
    const { fetch, urls } = fetchRecording();
    const { code, stderr } = await run(['pay', 'base', 'tokens', '--limit'], {
      fetch,
      env: { CAMBRIAN_SCHEMA_MODE: 'bundled', CAMBRIAN_X402_PRIVATE_KEY: `0x${'1'.repeat(64)}` },
    });
    expect(code).toBe(2);
    expect(stderr).toContain('--limit requires a value');
    expect(urls).toHaveLength(0);
  });

  it('explicit values and omitted flags keep working', async () => {
    const { fetch, urls } = fetchRecording();
    expect((await run(['base', 'lending-morpho-markets', '--min-tvl-usd', '5', '--limit', '3'], { fetch })).code).toBe(0);
    expect((await run(['base', 'lending-morpho-markets'], { fetch })).code).toBe(0);
    expect(urls[0].searchParams.get('min_tvl_usd')).toBe('5');
    expect(urls[0].searchParams.get('limit')).toBe('3');
    expect(urls[1].searchParams.has('min_tvl_usd')).toBe(false);
    expect(urls[1].searchParams.get('limit')).toBe('100');
  });
});

describe('mixed sort directions keep their empty positions', () => {
  it('sends the documented positional form unchanged', async () => {
    const { fetch, urls } = fetchRecording();
    const { code } = await run([
      'base', 'lending-morpho-markets', '--order-asc', 'supplyUsd,', '--order-desc', ',borrowUsd', '--limit', '2',
    ], { fetch });
    expect(code).toBe(0);
    expect(urls[0].searchParams.get('order_asc')).toBe('supplyUsd,');
    expect(urls[0].searchParams.get('order_desc')).toBe(',borrowUsd');
  });

  it('pay sends the same positional form', async () => {
    const { fetch, urls } = fetchRecording();
    await run([
      'pay', 'base', 'lending-morpho-markets', '--order-asc', 'supplyUsd,', '--order-desc', ',borrowUsd',
    ], {
      fetch,
      env: { CAMBRIAN_SCHEMA_MODE: 'bundled', CAMBRIAN_X402_PRIVATE_KEY: `0x${'1'.repeat(64)}` },
    });
    expect(urls[0].searchParams.get('order_asc')).toBe('supplyUsd,');
    expect(urls[0].searchParams.get('order_desc')).toBe(',borrowUsd');
  });

  it.each([
    [['--order-asc', 'supplyUsd', '--order-desc', 'borrowUsd'], 1],
    [['--order-asc', 'supplyUsd,tvlUsd', '--order-desc', ',borrowUsd'], 2],
  ])('a position named in both lists %j fails before any request', async (flags, position) => {
    const { fetch, urls } = fetchRecording();
    const { code, stderr } = await run(['base', 'lending-morpho-markets', ...flags], { fetch });
    expect(code).toBe(2);
    expect(stderr).toContain(`both name a column at position ${position}`);
    expect(urls).toHaveLength(0);
  });

  it('lists of different lengths are fine when no position overlaps', async () => {
    const { fetch, urls } = fetchRecording();
    const { code } = await run(
      ['base', 'lending-morpho-markets', '--order-asc', 'supplyUsd', '--order-desc', ',borrowUsd,tvlUsd'],
      { fetch },
    );
    expect(code).toBe(0);
    expect(urls[0].searchParams.get('order_desc')).toBe(',borrowUsd,tvlUsd');
  });

  it('single-direction sorts are unchanged', async () => {
    const { fetch, urls } = fetchRecording();
    await run(['base', 'lending-morpho-markets', '--order-desc', 'borrowUsd,tvlUsd'], { fetch });
    expect(urls[0].searchParams.get('order_desc')).toBe('borrowUsd,tvlUsd');
  });

  it('still validates named columns and rejects an all-empty list', async () => {
    const { fetch, urls } = fetchRecording();
    const bad = await run(['base', 'lending-morpho-markets', '--order-asc', 'nope,'], { fetch });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('--order-asc must be one of');
    const empty = await run(['base', 'lending-morpho-markets', '--order-asc', ','], { fetch });
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain('--order-asc must contain at least one value');
    expect(urls).toHaveLength(0);
  });

  it('other list flags still drop stray empty items', () => {
    const spec = { required: false, type: 'array', strict: true, items: { type: 'string' } };
    expect(coerceValue('a,,b,', spec, 'token-list')).toEqual(['a', 'b']);
    expect(coerceValue('a,,b,', spec, 'order-asc')).toEqual(['a', '', 'b', '']);
  });
});

describe('risk perp-risk-engine requires the full position', () => {
  it('a bare command exits 2 before any request', async () => {
    const { fetch, urls } = fetchRecording();
    const { code, stderr } = await run(['risk', 'perp-risk-engine'], { fetch });
    expect(code).toBe(2);
    expect(stderr).toContain('Missing required option --token-address');
    expect(urls).toHaveLength(0);
  });

  it('names the allowed values when a choice flag is wrong', async () => {
    const { fetch, urls } = fetchRecording();
    const { code, stderr } = await run([
      'risk', 'perp-risk-engine', '--token-address', 'So11111111111111111111111111111111111111112',
      '--entry-price', '150', '--leverage', '5', '--direction', 'sideways', '--risk-horizon', '1d',
    ], { fetch });
    expect(code).toBe(2);
    expect(stderr).toContain('--direction must be one of: long, short.');
    expect(urls).toHaveLength(0);
  });

  it('reads choices only from closed alternation patterns', () => {
    expect(patternChoices('^(long|short)$')).toEqual(['long', 'short']);
    expect(patternChoices('^(1h|1d|1w|1mo)$')).toEqual(['1h', '1d', '1w', '1mo']);
    expect(patternChoices('^(total|[1-9][0-9]*[hd])$')).toBeUndefined();
    expect(patternChoices('^0x[a-fA-F0-9]{40}$')).toBeUndefined();
    expect(patternChoices(undefined)).toBeUndefined();
  });

  it('sends exactly the position the user gives', async () => {
    const { fetch, urls } = fetchRecording();
    const { code } = await run([
      'risk', 'perp-risk-engine', '--token-address', 'So11111111111111111111111111111111111111112',
      '--entry-price', '150', '--leverage', '5', '--direction', 'short', '--risk-horizon', '1h',
    ], { fetch });
    expect(code).toBe(0);
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({
      token_address: 'So11111111111111111111111111111111111111112',
      entry_price: '150',
      leverage: '5',
      direction: 'short',
      risk_horizon: '1h',
    });
  });
});

describe('EVM token-address defaults stay on their own chain', () => {
  it.each(['ethereum', 'arbitrum', 'robinhood'])('%s price-current requires --token-address', async (chain) => {
    const { fetch, urls } = fetchRecording();
    const { code, stderr } = await run([chain, 'price-current'], { fetch });
    expect(code).toBe(2);
    expect(stderr).toContain('Missing required option --token-address');
    expect(urls).toHaveLength(0);
  });

  it('base price-current keeps the schema default token', async () => {
    const { fetch, urls } = fetchRecording();
    expect((await run(['base', 'price-current'], { fetch })).code).toBe(0);
    expect(urls[0].searchParams.get('chain_id')).toBe('8453');
    expect(urls[0].searchParams.get('token_address')).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  });

  it('an explicit Ethereum token is sent with chain_id=1', async () => {
    const { fetch, urls } = fetchRecording();
    const { code } = await run(
      ['ethereum', 'price-current', '--token-address', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
      { fetch },
    );
    expect(code).toBe(0);
    expect(urls[0].searchParams.get('chain_id')).toBe('1');
    expect(urls[0].searchParams.get('token_address')).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });
});
