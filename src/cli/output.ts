/**
 * Output formatting for the data path (opt-in via --output / --fields).
 *
 * Pure, dependency-free helpers. The default success output stays byte-identical
 * to before (pretty JSON via `formatResult(..., { output: 'json' })`); `table`
 * and `tsv` are opt-in, and `--fields` projects columns/keys before formatting.
 *
 * Non-tabular values (Deep42 rich objects, the Risk result, primitives) cannot
 * be tabulated, so `table`/`tsv` gracefully fall back to JSON rather than error.
 */

import { CliUsageError } from './core.js';
import type { TableResponse, TableColumn } from '../client/types.js';

export type OutputFormat = 'json' | 'table' | 'tsv';

export const OUTPUT_FORMATS: OutputFormat[] = ['json', 'table', 'tsv'];

const ELLIPSIS = '…';
const MIN_COL_WIDTH = 3;
const COL_GAP = '  ';

// ── Shape detection ──────────────────────────────────────────────

/** Structural check for the Opabinia TableResponse shape ({columns, data}). */
export function isTableResponse(v: unknown): v is TableResponse {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.columns) && Array.isArray(o.data);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The Opabinia (Solana/EVM) data path wraps its TableResponse in a single-element
 * array: `[{columns, data, rows}]`. Detect that envelope so the opt-in table/tsv/
 * `--fields` paths operate on the inner table instead of the 1-element wrapper.
 * Returns the inner table plus a `rewrap` to restore the original shape; null for
 * a bare TableResponse-less value. A bare TableResponse is reported as-is
 * (identity rewrap), so callers can treat both shapes uniformly.
 */
function unwrapTable(
  value: unknown,
): { table: TableResponse; rewrap: (t: TableResponse) => unknown } | null {
  if (isTableResponse(value)) return { table: value, rewrap: (t) => t };
  if (Array.isArray(value) && value.length === 1 && isTableResponse(value[0])) {
    return { table: value[0] as TableResponse, rewrap: (t) => [t] };
  }
  return null;
}

/** Projects a TableResponse to the named columns (unknown column → usage error). */
function projectTableColumns(table: TableResponse, fields: string[]): TableResponse {
  // An empty result (no columns — e.g. the upstream returned zero rows) carries no
  // schema to validate against; return it unchanged rather than erroring on every
  // requested field. This keeps --fields robust against transient empty responses.
  if (table.columns.length === 0) return table;
  const colNames = table.columns.map((c) => c.name);
  const indices = fields.map((f) => {
    const idx = colNames.indexOf(f);
    if (idx === -1) {
      throw new CliUsageError(`Unknown column "${f}" for --fields. Valid columns: ${colNames.join(', ')}.`);
    }
    return idx;
  });
  const columns = indices.map((i) => table.columns[i]);
  const data = table.data.map((row) => indices.map((i) => row[i]));
  return { columns, data, rows: data.length } as TableResponse;
}

// ── Cell stringification ─────────────────────────────────────────

/** Renders one cell for table/tsv: null/undefined → '', objects → compact JSON. */
function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ── Field projection (--fields) ──────────────────────────────────

function getPath(source: unknown, path: string): { found: boolean; value: unknown } {
  let cur: unknown = source;
  for (const part of path.split('.')) {
    if (isPlainObject(cur) && part in cur) {
      cur = cur[part];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: cur };
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!isPlainObject(cur[part])) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** Picks the requested dot-paths out of one object, preserving nesting. */
function pickPaths(source: unknown, paths: string[]): { obj: Record<string, unknown>; matchedPaths: string[] } {
  const obj: Record<string, unknown> = {};
  const matchedPaths: string[] = [];
  for (const path of paths) {
    const { found, value } = getPath(source, path);
    if (found) {
      setPath(obj, path, value);
      matchedPaths.push(path);
    }
  }
  return { obj, matchedPaths };
}

/**
 * Every requested --field must match at least one element/key; a field that
 * matches nothing is almost always a typo. Throwing here keeps the array/object
 * (dot-path) path consistent with the TableResponse path, which rejects any
 * unknown column. Lists the unmatched fields so the user can correct them.
 */
function assertAllFieldsMatched(fields: string[], matched: Set<string>): void {
  const missing = fields.filter((f) => !matched.has(f));
  if (missing.length > 0) {
    throw new CliUsageError(
      `--fields not found in the response: ${missing.join(', ')}. ` +
        'Check the field names against the JSON output.',
    );
  }
}

/**
 * Projects a value down to the requested fields. For a TableResponse the fields
 * are column names (unknown column → usage error). For an array of objects or a
 * single object they are dot-paths (missing paths are omitted; if *nothing*
 * matches, that is a usage error). This is a projection, not a query engine.
 */
export function projectFields(value: unknown, fields: string[]): unknown {
  const wrapped = unwrapTable(value);
  if (wrapped) {
    return wrapped.rewrap(projectTableColumns(wrapped.table, fields));
  }

  if (Array.isArray(value)) {
    const matched = new Set<string>();
    const projected = value.map((el) => {
      const { obj, matchedPaths } = pickPaths(el, fields);
      for (const p of matchedPaths) matched.add(p);
      return obj;
    });
    assertAllFieldsMatched(fields, matched);
    return projected;
  }

  if (isPlainObject(value)) {
    const { obj, matchedPaths } = pickPaths(value, fields);
    assertAllFieldsMatched(fields, new Set(matchedPaths));
    return obj;
  }

  throw new CliUsageError('--fields cannot be applied to a non-object response.');
}

// ── Tabular coercion ─────────────────────────────────────────────

/**
 * Reduces a value to columns + rows when it is tabular (a TableResponse, or a
 * non-empty array of plain objects). Returns null for everything else so the
 * caller can fall back to JSON.
 */
function toTabular(value: unknown): { columns: string[]; rows: unknown[][] } | null {
  const wrapped = unwrapTable(value);
  if (wrapped) {
    return { columns: wrapped.table.columns.map((c: TableColumn) => c.name), rows: wrapped.table.data };
  }
  if (Array.isArray(value) && value.length > 0 && value.every(isPlainObject)) {
    const columns: string[] = [];
    for (const el of value) {
      for (const key of Object.keys(el)) {
        if (!columns.includes(key)) columns.push(key);
      }
    }
    const rows = value.map((el) => columns.map((c) => (el as Record<string, unknown>)[c]));
    return { columns, rows };
  }
  return null;
}

// ── Renderers ────────────────────────────────────────────────────

function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  if (width <= 1) return s.slice(0, width);
  return s.slice(0, width - 1) + ELLIPSIS;
}

/**
 * Renders an aligned ASCII table. Columns are sized to their content, then —
 * if the total exceeds maxWidth — the widest columns are shrunk (down to a
 * floor) and cells ellipsis-truncated. No color is emitted (NO_COLOR-safe).
 */
export function renderTable(
  columns: string[],
  rows: unknown[][],
  opts: { maxWidth?: number } = {},
): string {
  const maxWidth = opts.maxWidth ?? 80;
  if (columns.length === 0) return '';

  const body = rows.map((row) => columns.map((_, i) => stringifyCell(row[i])));
  const widths = columns.map((header, i) =>
    Math.max(header.length, ...body.map((row) => row[i].length), 0),
  );

  // Shrink the widest column repeatedly until the line fits maxWidth.
  const gap = COL_GAP.length;
  const lineWidth = () => widths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
  while (lineWidth() > maxWidth) {
    let widest = 0;
    for (let i = 1; i < widths.length; i += 1) if (widths[i] > widths[widest]) widest = i;
    if (widths[widest] <= MIN_COL_WIDTH) break;
    widths[widest] -= 1;
  }

  const renderRow = (cells: string[]): string =>
    cells.map((cell, i) => truncate(cell, widths[i]).padEnd(widths[i])).join(COL_GAP).trimEnd();

  const lines: string[] = [];
  lines.push(renderRow(columns));
  lines.push(widths.map((w) => '─'.repeat(w)).join(COL_GAP));
  for (const row of body) lines.push(renderRow(row));
  return lines.join('\n');
}

/** Tab-separated values with a header line. No truncation (pipe-friendly). */
export function toTsv(columns: string[], rows: unknown[][]): string {
  const clean = (s: string): string => s.replace(/[\t\r\n]+/g, ' ');
  const lines: string[] = [columns.map(clean).join('\t')];
  for (const row of rows) {
    lines.push(columns.map((_, i) => clean(stringifyCell(row[i]))).join('\t'));
  }
  return lines.join('\n');
}

// ── Top-level formatter ──────────────────────────────────────────

/**
 * Projects (if fields given) then renders a result to the requested format.
 * `json` is the default and is byte-identical to the prior pretty-JSON output.
 * `table`/`tsv` fall back to JSON for non-tabular values.
 */
export function formatResult(
  value: unknown,
  opts: { output?: OutputFormat; fields?: string[]; maxWidth?: number } = {},
): string {
  const { output = 'json', fields, maxWidth } = opts;
  const projected = fields && fields.length > 0 ? projectFields(value, fields) : value;

  if (output === 'json') return JSON.stringify(projected, null, 2);

  const tabular = toTabular(projected);
  if (!tabular) return JSON.stringify(projected, null, 2); // graceful fallback

  return output === 'tsv'
    ? toTsv(tabular.columns, tabular.rows)
    : renderTable(tabular.columns, tabular.rows, { maxWidth });
}
