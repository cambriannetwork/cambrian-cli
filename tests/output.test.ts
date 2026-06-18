/**
 * Unit tests for the pure output helpers (projection, table/tsv rendering, and
 * the top-level formatResult with its non-tabular JSON fallback). No I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  isTableResponse,
  projectFields,
  renderTable,
  toTsv,
  formatResult,
} from '../src/cli/output.js';
import { CliUsageError } from '../src/cli/core.js';

const TABLE = {
  columns: [
    { name: 'symbol', type: 'string' },
    { name: 'priceUSD', type: 'number' },
    { name: 'volume', type: 'number' },
  ],
  data: [
    ['SOL', 150.25, 1000],
    ['USDC', 1.0, 5000],
  ],
  rows: 2,
};

describe('isTableResponse', () => {
  it('recognizes the TableResponse shape', () => {
    expect(isTableResponse(TABLE)).toBe(true);
  });
  it('rejects arrays, plain objects, and primitives', () => {
    expect(isTableResponse([1, 2, 3])).toBe(false);
    expect(isTableResponse({ status: 'ok' })).toBe(false);
    expect(isTableResponse(null)).toBe(false);
    expect(isTableResponse(42)).toBe(false);
  });
});

describe('projectFields', () => {
  it('keeps only the named columns of a TableResponse', () => {
    const out = projectFields(TABLE, ['symbol', 'volume']) as typeof TABLE;
    expect(out.columns.map((c) => c.name)).toEqual(['symbol', 'volume']);
    expect(out.data).toEqual([
      ['SOL', 1000],
      ['USDC', 5000],
    ]);
    expect(out.rows).toBe(2);
    // result is still a TableResponse (so downstream table/tsv work)
    expect(isTableResponse(out)).toBe(true);
  });

  it('returns an empty TableResponse unchanged (no schema to validate against)', () => {
    // Transient empty upstream response: --fields must not hard-error.
    const empty = { columns: [], data: [], rows: 0 };
    expect(projectFields(empty, ['symbol'])).toEqual(empty);
    expect(projectFields([empty], ['symbol'])).toEqual([empty]); // wrapped envelope too
  });

  it('throws a usage error listing valid columns on an unknown column', () => {
    expect(() => projectFields(TABLE, ['symbol', 'nope'])).toThrowError(CliUsageError);
    try {
      projectFields(TABLE, ['nope']);
    } catch (e) {
      expect((e as Error).message).toContain('symbol');
      expect((e as Error).message).toContain('priceUSD');
    }
  });

  it('projects dot-paths out of an array of objects', () => {
    const arr = [
      { a: { b: 1, c: 2 }, d: 3 },
      { a: { b: 9, c: 8 }, d: 7 },
    ];
    expect(projectFields(arr, ['a.b', 'd'])).toEqual([
      { a: { b: 1 }, d: 3 },
      { a: { b: 9 }, d: 7 },
    ]);
  });

  it('projects keys out of a single object', () => {
    expect(projectFields({ x: 1, y: 2, z: 3 }, ['x', 'z'])).toEqual({ x: 1, z: 3 });
  });

  it('throws when no field matches anything (array)', () => {
    expect(() => projectFields([{ a: 1 }], ['missing'])).toThrowError(CliUsageError);
  });

  it('throws when no field matches anything (object)', () => {
    expect(() => projectFields({ a: 1 }, ['missing'])).toThrowError(CliUsageError);
  });

  it('throws when SOME fields match but others do not (array) — lists the missing', () => {
    // Regression: a partial match must not silently drop the unknown field.
    try {
      projectFields([{ a: 1, b: 2 }], ['a', 'nope']);
      throw new Error('expected projectFields to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CliUsageError);
      expect((e as Error).message).toContain('nope');
      expect((e as Error).message).not.toContain(' a,'); // the matched field is not reported missing
    }
  });

  it('throws when some fields match but others do not (object)', () => {
    expect(() => projectFields({ x: 1, y: 2 }, ['x', 'missing'])).toThrowError(CliUsageError);
  });

  it('accepts a field present in only SOME array elements (no error)', () => {
    // A field that appears in at least one element is valid (dynamic JSON shapes).
    const out = projectFields([{ a: 1, b: 2 }, { a: 3 }], ['a', 'b']);
    expect(out).toEqual([{ a: 1, b: 2 }, { a: 3 }]);
  });
});

// The real Opabinia (Solana/EVM) data path returns the TableResponse wrapped in
// a single-element array. These lock the regression where table/tsv/--fields
// operated on the 1-element wrapper instead of the inner table.
describe('wrapped [TableResponse] envelope (the live Opabinia shape)', () => {
  const WRAPPED = [TABLE];

  it('projects columns of a wrapped table and preserves the wrapper shape', () => {
    const out = projectFields(WRAPPED, ['symbol', 'volume']) as [typeof TABLE];
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].columns.map((c) => c.name)).toEqual(['symbol', 'volume']);
    expect(out[0].data).toEqual([
      ['SOL', 1000],
      ['USDC', 5000],
    ]);
  });

  it('throws on an unknown column inside a wrapped table', () => {
    expect(() => projectFields(WRAPPED, ['nope'])).toThrowError(CliUsageError);
  });

  it('renders a wrapped table as a table / tsv (not the 1-element wrapper)', () => {
    expect(formatResult(WRAPPED, { output: 'table' }).split('\n')[0]).toBe('symbol  priceUSD  volume');
    expect(formatResult(WRAPPED, { output: 'tsv' }).split('\n')[0]).toBe('symbol\tpriceUSD\tvolume');
  });

  it('still defaults to byte-identical JSON for the wrapped shape', () => {
    expect(formatResult(WRAPPED)).toBe(JSON.stringify(WRAPPED, null, 2));
  });

  it('does NOT unwrap a genuine multi-element array of tables', () => {
    // two tables in the array → treated as array-of-objects, not unwrapped:
    // columns are the wrapper keys and there are two data rows.
    const out = formatResult([TABLE, TABLE], { output: 'table' });
    const lines = out.split('\n');
    expect(lines[0].trim().split(/\s+/)).toEqual(['columns', 'data', 'rows']);
    expect(lines.filter((l) => l.includes('symbol'))).toHaveLength(2); // 2 table rows, not unwrapped
  });
});

describe('renderTable', () => {
  it('aligns columns with a header separator', () => {
    const out = renderTable(
      TABLE.columns.map((c) => c.name),
      TABLE.data,
    );
    const lines = out.split('\n');
    expect(lines[0]).toBe('symbol  priceUSD  volume');
    expect(lines[1]).toMatch(/^─+  ─+  ─+$/);
    // null / object cells stringify sensibly
    const out2 = renderTable(['a', 'b'], [[null, { k: 1 }]]);
    expect(out2.split('\n')[2]).toContain('{"k":1}');
  });

  it('truncates with an ellipsis when over maxWidth', () => {
    const out = renderTable(['name'], [['abcdefghijklmnop']], { maxWidth: 6 });
    const last = out.split('\n')[2];
    expect(last).toContain('…');
    expect(last.length).toBeLessThanOrEqual(6);
  });
});

describe('toTsv', () => {
  it('emits a header line and tab-separated rows', () => {
    const out = toTsv(
      TABLE.columns.map((c) => c.name),
      TABLE.data,
    );
    const lines = out.split('\n');
    expect(lines[0]).toBe('symbol\tpriceUSD\tvolume');
    expect(lines[1]).toBe('SOL\t150.25\t1000');
  });

  it('sanitizes embedded tabs/newlines in cells', () => {
    const out = toTsv(['a'], [['x\ty\nz']]);
    expect(out.split('\n')[1]).toBe('x y z');
  });
});

describe('formatResult', () => {
  it('defaults to pretty JSON (byte-identical to JSON.stringify(v, null, 2))', () => {
    expect(formatResult(TABLE)).toBe(JSON.stringify(TABLE, null, 2));
    expect(formatResult(TABLE, { output: 'json' })).toBe(JSON.stringify(TABLE, null, 2));
  });

  it('renders a TableResponse as an aligned table', () => {
    const out = formatResult(TABLE, { output: 'table' });
    expect(out.split('\n')[0]).toBe('symbol  priceUSD  volume');
  });

  it('renders a TableResponse as tsv', () => {
    const out = formatResult(TABLE, { output: 'tsv' });
    expect(out.split('\n')[0]).toBe('symbol\tpriceUSD\tvolume');
  });

  it('falls back to JSON for non-tabular values under table/tsv', () => {
    const obj = { status: 'ok', riskProbability: 0.1 };
    expect(formatResult(obj, { output: 'table' })).toBe(JSON.stringify(obj, null, 2));
    expect(formatResult(obj, { output: 'tsv' })).toBe(JSON.stringify(obj, null, 2));
  });

  it('derives table columns from an array of flat objects', () => {
    const out = formatResult([{ a: 1, b: 2 }], { output: 'table' });
    expect(out.split('\n')[0]).toBe('a  b');
  });

  it('projects with --fields before formatting', () => {
    const out = formatResult(TABLE, { output: 'tsv', fields: ['symbol'] });
    expect(out).toBe('symbol\nSOL\nUSDC');
  });
});
