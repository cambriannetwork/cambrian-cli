/**
 * Auto-pagination for the data path (opt-in via --all / --max-items).
 *
 * Loops `limit`/`offset` over a single endpoint and merges pages back into the
 * first page's shape. All API calls are GET, so this is safe. A hard default cap
 * (DEFAULT_MAX_ITEMS) protects the metered API from runaway pulls.
 */

import { CliUsageError } from './core.js';
import { isTableResponse } from './output.js';
import type { TableResponse } from '../client/types.js';

export type PageQueryFn = (apiPath: string, params: Record<string, unknown>) => Promise<unknown>;

/** Default total-row cap when --all is set without an explicit --max-items. */
export const DEFAULT_MAX_ITEMS = 10_000;

/** Page size fallback when the endpoint's `limit` param carries no `max`. */
export const DEFAULT_PAGE_SIZE = 1_000;

/** A single-element array wrapping a TableResponse, as the Opabinia path returns. */
function asWrappedTable(page: unknown): TableResponse | null {
  return Array.isArray(page) && page.length === 1 && isTableResponse(page[0])
    ? (page[0] as TableResponse)
    : null;
}

/** Pulls the row list out of a page; null when the shape is not pageable. */
function extractRows(page: unknown): unknown[] | null {
  if (isTableResponse(page)) return page.data;
  const wrapped = asWrappedTable(page);
  if (wrapped) return wrapped.data;
  if (Array.isArray(page)) return page;
  return null;
}

/**
 * Repeatedly queries `apiPath`, advancing `offset` by `pageSize`, until a short
 * page is returned or `maxItems` rows are collected. Rebuilds the first page's
 * shape: a TableResponse → `{columns, data, rows}`; a bare array → the array.
 *
 * @param resourceLabel  "<group> <resource>", used only in the error message
 *                       when a response turns out not to be a list.
 */
export async function collectAllPages(
  queryFn: PageQueryFn,
  apiPath: string,
  baseParams: Record<string, unknown>,
  resourceLabel: string,
  opts: { pageSize: number; maxItems: number },
): Promise<unknown> {
  const { pageSize, maxItems } = opts;
  let offset = Number(baseParams.offset);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const merged: unknown[] = [];
  let firstTable: TableResponse | null = null;
  let firstWrapped = false;

  for (;;) {
    const page = await queryFn(apiPath, { ...baseParams, limit: pageSize, offset });
    const rows = extractRows(page);
    if (rows === null) {
      throw new CliUsageError(
        `--all is not supported for ${resourceLabel} (response is not a list).`,
      );
    }
    if (firstTable === null && merged.length === 0) {
      const wrapped = asWrappedTable(page);
      if (wrapped) {
        firstTable = wrapped;
        firstWrapped = true;
      } else if (isTableResponse(page)) {
        firstTable = page;
      }
    }

    for (const row of rows) {
      if (merged.length >= maxItems) break;
      merged.push(row);
    }

    if (merged.length >= maxItems) break;
    if (rows.length < pageSize) break; // last page reached
    offset += pageSize;
  }

  const finalRows = merged.slice(0, maxItems);
  if (firstTable) {
    const rebuilt = { columns: firstTable.columns, data: finalRows as unknown[][], rows: finalRows.length };
    return firstWrapped ? [rebuilt] : rebuilt;
  }
  return finalRows;
}
