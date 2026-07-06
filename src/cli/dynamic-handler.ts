import type { ParsedArgs, Runtime } from './core.js';
import {
  getOption,
  hasOption,
  requireOptionValue,
  assertNoUnknownOptions,
  parseCsvValues,
  parsePositiveInt,
  CliUsageError,
} from './core.js';
import { didYouMean } from './suggest.js';
import { formatResult, OUTPUT_FORMATS, type OutputFormat } from './output.js';
import { collectAllPages, DEFAULT_MAX_ITEMS, DEFAULT_PAGE_SIZE } from './paginate.js';
import type { EndpointSpec, GroupSpec, ParamSpec } from '../metadata.js';
export type { GroupSpec, ParamSpec } from '../metadata.js';

/** Opt-in data-path flags shared by every command group (added to *_GLOBAL_OPTIONS). */
export const DATA_OUTPUT_GLOBAL_OPTIONS = ['all', 'max-items', 'fields', 'output'];

// ── Derive CLI metadata from spec ────────────────────────────────

export function deriveCliMetadata(
  spec: GroupSpec,
  cliDefaults: Record<string, Record<string, string>> = {},
) {
  const resources: string[] = Object.keys(spec);
  const allowedOptions: Record<string, string[]> = {};
  const requiredOptions: Record<string, string[]> = {};

  for (const [resource, entry] of Object.entries(spec)) {
    const defaults = cliDefaults[resource] ?? {};
    allowedOptions[resource] = Object.keys(entry.params).map((p) => p.replace(/_/g, '-'));
    requiredOptions[resource] = Object.entries(entry.params)
      .filter(([k, v]) => v.required && !(k in defaults) && v.default === undefined)
      .map(([k]) => k.replace(/_/g, '-'));
  }

  return { resources, allowedOptions, requiredOptions };
}

// ── Type coercion from spec metadata ─────────────────────────────

export function coerceValue(value: string, paramSpec: ParamSpec, cliFlag: string): unknown {
  // Enum validation (case-insensitive match, returns canonical casing)
  if (paramSpec.enum) {
    const match = paramSpec.enum.find((e) => e.toLowerCase() === value.toLowerCase());
    if (!match) {
      throw new CliUsageError(`--${cliFlag} must be one of: ${paramSpec.enum.join(', ')}.`);
    }
    return match;
  }

  switch (paramSpec.type) {
    case 'integer': {
      const n = Number.parseInt(value, 10);
      if (!Number.isInteger(n)) {
        throw new CliUsageError(`--${cliFlag} must be an integer.`);
      }
      if (paramSpec.min !== undefined && n < paramSpec.min) {
        throw new CliUsageError(`--${cliFlag} must be at least ${paramSpec.min}.`);
      }
      if (paramSpec.max !== undefined && n > paramSpec.max) {
        throw new CliUsageError(`--${cliFlag} must be at most ${paramSpec.max}.`);
      }
      return n;
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new CliUsageError(`--${cliFlag} must be a number.`);
      }
      if (paramSpec.min !== undefined && n < paramSpec.min) {
        throw new CliUsageError(`--${cliFlag} must be at least ${paramSpec.min}.`);
      }
      if (paramSpec.max !== undefined && n > paramSpec.max) {
        throw new CliUsageError(`--${cliFlag} must be at most ${paramSpec.max}.`);
      }
      return n;
    }
    case 'array':
      return value.split(',').map((s) => s.trim());
    default:
      return value;
  }
}

// ── Schema hint formatting (offline, from bundled OpenAPI schema) ──

/**
 * Renders default/min/max from the bundled schema as a compact suffix for a
 * --help flag line, e.g. " (default: 100, 1-1000)". Returns '' when the spec
 * carries none of these. Purely offline — never fetches.
 */
export function formatSchemaHints(ps: ParamSpec): string {
  const parts: string[] = [];
  if (ps.default !== undefined) parts.push(`default: ${ps.default}`);
  if (ps.min !== undefined && ps.max !== undefined) {
    parts.push(`${ps.min}-${ps.max}`);
  } else if (ps.min !== undefined) {
    parts.push(`min: ${ps.min}`);
  } else if (ps.max !== undefined) {
    parts.push(`max: ${ps.max}`);
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

// ── Per-resource --help builder ──────────────────────────────────

/** Picks a representative value for a required flag in the example line. */
function exampleValueFor(apiParam: string, ps: ParamSpec | undefined): string {
  if (ps?.enum && ps.enum.length > 0) return ps.enum[0];
  if (ps?.default !== undefined) return String(ps.default);
  return `<${apiParam}>`;
}

/**
 * Builds the offline `--help` text for a single resource: the flag list (with
 * required markers, enums, and schema hints), a minimal runnable example built
 * from the required params, the shared global options, and a prominent pointer
 * to the live `cambrian docs` for full field/unit descriptions (which live in
 * llms.txt, not the bundled schema).
 */
export function buildResourceHelp(
  groupCommand: string,
  resource: string,
  entry: EndpointSpec,
  allowed: string[],
  required: string[],
): string {
  const requiredSet = new Set(required);

  const flagLines =
    allowed.length > 0
      ? allowed.map((f) => {
          const apiParam = f.replace(/-/g, '_');
          const ps = entry.params[apiParam];
          let line = `  --${f}`;
          if (requiredSet.has(f)) line += ' (required)';
          if (ps?.enum) line += ` [${ps.enum.join('|')}]`;
          if (ps) line += formatSchemaHints(ps);
          if (ps?.description) line += `\n      ${ps.description}`;
          return line;
        })
      : ['  (no additional options)'];

  // Minimal runnable example: fill the required params with representative values.
  const exampleFlags = allowed
    .filter((f) => requiredSet.has(f))
    .map((f) => {
      const apiParam = f.replace(/-/g, '_');
      return `--${f} ${exampleValueFor(apiParam, entry.params[apiParam])}`;
    });
  const exampleCmd =
    `cambrian ${groupCommand} ${resource}` +
    (exampleFlags.length > 0 ? ` ${exampleFlags.join(' ')}` : '');

  return [
    `cambrian ${groupCommand} ${resource}`,
    '',
    'Options:',
    ...flagLines,
    '',
    'Example:',
    `  # Query ${resource}`,
    `  $ ${exampleCmd}`,
    '',
    'Global options:',
    '  --json            Machine-readable JSON output (errors as structured JSON on stderr).',
    '  --output <fmt>    Output format: json (default), table, or tsv.',
    '  --fields a,b,c    Project to only these columns/fields (comma-separated).',
    '  --all             Auto-paginate and merge all pages (paginated resources only).',
    '  --max-items <n>   Cap total rows when paginating (default 10000).',
    '  --timeout <ms>    Per-request timeout in milliseconds (default 90000).',
    '  --retries <n>     Retry transient failures (408/429/5xx) with backoff (default 0).',
    '  --api-key <key>   API key (falls back to CAMBRIAN_API_KEY).',
    '',
    `▶ Full docs, field descriptions & examples:  cambrian docs ${groupCommand} ${resource}`,
  ].join('\n');
}

// ── Generic dynamic handler ──────────────────────────────────────

export type QueryFn = (apiPath: string, params: Record<string, unknown>) => Promise<unknown>;

export async function handleDynamicQuery(
  resource: string,
  parsed: ParsedArgs,
  runtime: Runtime,
  queryFn: QueryFn,
  spec: GroupSpec,
  groupCommand: string,
  globalOptions: string[],
  cliDefaults: Record<string, Record<string, string>>,
  allowedOptions: Record<string, string[]>,
  requiredOptions: Record<string, string[]>,
  helpFn: () => string,
): Promise<number> {
  if (!resource) {
    runtime.stdout(helpFn());
    return 0;
  }

  const entry = spec[resource];
  if (!entry) {
    const suggestion = didYouMean(resource, Object.keys(spec));
    throw new CliUsageError(
      `Unknown ${groupCommand} resource: ${resource}.${suggestion} Run "cambrian ${groupCommand} --help" for a list.`,
    );
  }

  if (hasOption(parsed, 'help')) {
    runtime.stdout(
      buildResourceHelp(
        groupCommand,
        resource,
        entry,
        allowedOptions[resource] ?? [],
        requiredOptions[resource] ?? [],
      ),
    );
    return 0;
  }

  assertNoUnknownOptions(
    parsed,
    [...globalOptions, ...(allowedOptions[resource] ?? [])],
    `${groupCommand} ${resource}`,
  );

  // ── Phase 2 opt-in data-path flags (--output / --fields / --all / --max-items)
  const output = parseOutputFormat(parsed);
  const fields = hasOption(parsed, 'fields')
    ? parseCsvValues(getOption(parsed, 'fields') ?? '', 'fields')
    : undefined;
  const wantAll = hasOption(parsed, 'all');
  const hasMaxItems = hasOption(parsed, 'max-items');
  if (hasMaxItems && !wantAll) {
    throw new CliUsageError('--max-items requires --all.');
  }
  if (wantAll && (!('limit' in entry.params) || !('offset' in entry.params))) {
    throw new CliUsageError(
      `--all is not supported for ${groupCommand} ${resource} (no pagination).`,
    );
  }

  // Build query params with type coercion and CLI defaults
  const defaults = cliDefaults[resource] ?? {};
  const queryParams: Record<string, unknown> = {};

  for (const [apiParam, paramSpec] of Object.entries(entry.params)) {
    const cliFlag = apiParam.replace(/_/g, '-');

    // Boolean params: presence of flag = true
    if (paramSpec.type === 'boolean') {
      if (hasOption(parsed, cliFlag)) {
        queryParams[apiParam] = true;
      }
      continue;
    }

    const rawValue = getOption(parsed, cliFlag);

    if (rawValue && rawValue !== 'true') {
      queryParams[apiParam] = coerceValue(rawValue, paramSpec, cliFlag);
    } else if (apiParam in defaults) {
      queryParams[apiParam] = coerceValue(defaults[apiParam], paramSpec, cliFlag);
    } else if (paramSpec.default !== undefined) {
      queryParams[apiParam] = coerceValue(String(paramSpec.default), paramSpec, cliFlag);
    } else if (paramSpec.required) {
      throw new CliUsageError(`Missing required option --${cliFlag}.`);
    }
  }

  let result: unknown;
  if (wantAll) {
    const limitSpec = entry.params.limit;
    const userLimit = getOption(parsed, 'limit');
    const pageSize =
      userLimit !== undefined && userLimit !== 'true' && typeof queryParams.limit === 'number'
        ? queryParams.limit
        : typeof limitSpec?.max === 'number'
          ? limitSpec.max
          : DEFAULT_PAGE_SIZE;
    const maxItems = hasMaxItems
      ? parsePositiveInt(getOption(parsed, 'max-items') ?? '', 'max-items')
      : DEFAULT_MAX_ITEMS;
    result = await collectAllPages(
      queryFn,
      entry.apiPath,
      queryParams,
      `${groupCommand} ${resource}`,
      { pageSize, maxItems },
    );
  } else {
    result = await queryFn(entry.apiPath, queryParams);
  }

  const maxWidth =
    typeof process !== 'undefined' && process.stdout && typeof process.stdout.columns === 'number'
      ? process.stdout.columns
      : 80;
  runtime.stdout(formatResult(result, { output, fields, maxWidth }));
  return 0;
}

/** Parses & validates the --output flag; defaults to 'json' (today's behavior). */
function parseOutputFormat(parsed: ParsedArgs): OutputFormat {
  if (!hasOption(parsed, 'output')) return 'json';
  const raw = requireOptionValue(parsed, 'output');
  if (!OUTPUT_FORMATS.includes(raw as OutputFormat)) {
    throw new CliUsageError(`--output must be one of: ${OUTPUT_FORMATS.join(', ')}.`);
  }
  return raw as OutputFormat;
}

// ── Categorized help builder ─────────────────────────────────────

export function buildCategorizedHelp(
  resources: string[],
  categoryFn: (resource: string) => string,
  commandName: string,
  options?: { extraLines?: string[]; categoryOrder?: string[] },
): string {
  // Group resources by category, preserving insertion order
  const categories = new Map<string, string[]>();
  for (const r of resources) {
    const cat = categoryFn(r);
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(r);
  }

  // Apply category ordering if specified
  const orderedCategories: [string, string[]][] = [];
  if (options?.categoryOrder) {
    for (const cat of options.categoryOrder) {
      const items = categories.get(cat);
      if (items) {
        orderedCategories.push([cat, items]);
        categories.delete(cat);
      }
    }
  }
  // Append any remaining categories not in the order list
  for (const [cat, items] of categories) {
    orderedCategories.push([cat, items]);
  }

  const lines = ['Usage:', `  cambrian ${commandName} <resource> [options]`, '', 'Resources:'];

  // Use dynamic column width based on longest resource name
  const maxLen = Math.max(...resources.map((r) => r.length));
  const colWidth = Math.max(maxLen + 2, 26);

  for (const [category, items] of orderedCategories) {
    lines.push(`  ${category}:`);
    // Fit as many columns as possible within ~80 char width (4 indent)
    const cols = Math.max(1, Math.floor(76 / colWidth));
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      lines.push('    ' + row.map((r) => r.padEnd(colWidth)).join('').trimEnd());
    }
  }

  if (options?.extraLines) lines.push('', ...options.extraLines);

  lines.push('', 'Global options:', '  --api-key <key>    API key (falls back to CAMBRIAN_API_KEY).', '  --help             Show this help.');

  return lines.join('\n');
}
