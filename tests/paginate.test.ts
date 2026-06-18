/**
 * Unit tests for collectAllPages: page merging, the --max-items cap, short-page
 * termination, bare-array responses, and the not-a-list guard. The "queryFn" is
 * a stub that serves slices of a fixture by offset — no network, no real client.
 */

import { describe, it, expect } from 'vitest';
import { collectAllPages, DEFAULT_MAX_ITEMS } from '../src/cli/paginate.js';
import { CliUsageError } from '../src/cli/core.js';

const COLUMNS = [{ name: 'i', type: 'number' }];

/** A TableResponse pager over `total` synthetic rows; records call count. */
function tablePager(total: number) {
  let calls = 0;
  const fn = async (_path: string, params: Record<string, unknown>) => {
    calls += 1;
    const limit = Number(params.limit);
    const offset = Number(params.offset);
    const slice = Array.from({ length: total }, (_, i) => [i]).slice(offset, offset + limit);
    return { columns: COLUMNS, data: slice, rows: slice.length };
  };
  return { fn, getCalls: () => calls };
}

describe('collectAllPages', () => {
  it('merges multiple pages in order into a TableResponse', async () => {
    const { fn, getCalls } = tablePager(25);
    const out = (await collectAllPages(fn, '/x', { offset: 0 }, 'solana tokens', {
      pageSize: 10,
      maxItems: DEFAULT_MAX_ITEMS,
    })) as { columns: unknown[]; data: number[][]; rows: number };
    expect(out.data.map((r) => r[0])).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(out.rows).toBe(25);
    expect(getCalls()).toBe(3); // 10 + 10 + 5 (short page stops)
  });

  it('caps total rows at maxItems, mid-page', async () => {
    const { fn, getCalls } = tablePager(1000);
    const out = (await collectAllPages(fn, '/x', { offset: 0 }, 'solana tokens', {
      pageSize: 10,
      maxItems: 25,
    })) as { data: number[][]; rows: number };
    expect(out.rows).toBe(25);
    expect(out.data.at(-1)![0]).toBe(24);
    expect(getCalls()).toBe(3); // stops once 25 collected
  });

  it('makes a single call when the first page is short', async () => {
    const { fn, getCalls } = tablePager(4);
    const out = (await collectAllPages(fn, '/x', {}, 'solana tokens', {
      pageSize: 10,
      maxItems: DEFAULT_MAX_ITEMS,
    })) as { rows: number };
    expect(out.rows).toBe(4);
    expect(getCalls()).toBe(1);
  });

  it('honors a non-zero starting offset', async () => {
    const { fn } = tablePager(30);
    const out = (await collectAllPages(fn, '/x', { offset: 20 }, 'solana tokens', {
      pageSize: 10,
      maxItems: DEFAULT_MAX_ITEMS,
    })) as { data: number[][] };
    expect(out.data.map((r) => r[0])).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it('merges bare-array responses', async () => {
    let calls = 0;
    const fn = async (_p: string, params: Record<string, unknown>) => {
      calls += 1;
      const offset = Number(params.offset);
      const limit = Number(params.limit);
      return Array.from({ length: 15 }, (_, i) => ({ i })).slice(offset, offset + limit);
    };
    const out = (await collectAllPages(fn, '/x', { offset: 0 }, 'deep42 x', {
      pageSize: 10,
      maxItems: DEFAULT_MAX_ITEMS,
    })) as Array<{ i: number }>;
    expect(out).toHaveLength(15);
    expect(out.map((o) => o.i)).toEqual(Array.from({ length: 15 }, (_, i) => i));
    expect(calls).toBe(2);
  });

  it('pages a wrapped [TableResponse] envelope and rebuilds the wrapper', async () => {
    // The live Opabinia path returns the table wrapped in a 1-element array.
    let calls = 0;
    const fn = async (_p: string, params: Record<string, unknown>) => {
      calls += 1;
      const limit = Number(params.limit);
      const offset = Number(params.offset);
      const slice = Array.from({ length: 25 }, (_, i) => [i]).slice(offset, offset + limit);
      return [{ columns: COLUMNS, data: slice, rows: slice.length }];
    };
    const out = (await collectAllPages(fn, '/x', { offset: 0 }, 'solana tokens', {
      pageSize: 10,
      maxItems: DEFAULT_MAX_ITEMS,
    })) as [{ data: number[][]; rows: number }];
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].rows).toBe(25);
    expect(out[0].data.map((r) => r[0])).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(calls).toBe(3); // 10 + 10 + 5, paged on the inner rows (not the 1-element wrapper)
  });

  it('throws a usage error when the response is not a list', async () => {
    const fn = async () => ({ status: 'ok', notAList: true });
    await expect(
      collectAllPages(fn, '/x', {}, 'deep42 token-analysis', {
        pageSize: 10,
        maxItems: DEFAULT_MAX_ITEMS,
      }),
    ).rejects.toBeInstanceOf(CliUsageError);
  });
});
