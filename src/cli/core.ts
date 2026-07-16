import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir as defaultHomedir } from 'os';
import { realpathSync } from 'fs';
import { pathToFileURL } from 'url';
import { ApiError } from '../client/index.js';

// Re-export so existing imports of ApiError from this module keep working.
export { ApiError };

// ── Types ──────────────────────────────────────────────────────────

export interface ParsedArgs {
  positionals: string[];
  options: Map<string, string[]>;
}

export interface Runtime {
  stdout: (line: string) => void;
  stdoutRaw: (text: string) => void;
  stderr: (line: string) => void;
  fetch: typeof globalThis.fetch;
  env: Record<string, string | undefined>;
  homedir: () => string;
  isTTY: boolean;
}

// ── Errors ─────────────────────────────────────────────────────────

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

// ── Runtime factory ────────────────────────────────────────────────

export function createRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    stdout: overrides.stdout ?? ((line: string) => process.stdout.write(`${line}\n`)),
    stdoutRaw: overrides.stdoutRaw ?? ((text: string) => process.stdout.write(text)),
    stderr: overrides.stderr ?? ((line: string) => process.stderr.write(`${line}\n`)),
    fetch: overrides.fetch ?? globalThis.fetch,
    env: overrides.env ?? (process.env as Record<string, string | undefined>),
    homedir: overrides.homedir ?? defaultHomedir,
    isTTY: overrides.isTTY ?? process.stdout.isTTY === true,
  };
}

// ── Arg parsing (hand-rolled, zero deps) ───────────────────────────

const BARE_BOOLEAN_OPTIONS = new Set([
  'help',
  'version',
  'json',
  'all',
  'yes',
  'dry-run',
  'discover',
  'offline',
  // Current schema boolean params. Keeping them here prevents boolean API flags
  // from accidentally consuming the next token as a value.
  'whitelisted',
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;

    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith('--')) {
      const [rawName, inlineValue] = token.slice(2).split('=', 2);
      const name = rawName.trim();
      if (name.length === 0) {
        throw new Error('Invalid empty option name.');
      }

      let value = inlineValue;
      if (value === undefined) {
        const next = argv[index + 1];
        if (!BARE_BOOLEAN_OPTIONS.has(name) && next && !next.startsWith('--')) {
          value = next;
          index += 1;
        } else {
          value = 'true';
        }
      }

      const existing = options.get(name) ?? [];
      existing.push(value);
      options.set(name, existing);
      continue;
    }

    if (token.startsWith('-')) {
      if (token === '-h') {
        const existing = options.get('help') ?? [];
        existing.push('true');
        options.set('help', existing);
        continue;
      }
      throw new CliUsageError(`Short options are not supported: ${token}`);
    }

    positionals.push(token);
  }

  return { positionals, options };
}

// ── Option helpers ─────────────────────────────────────────────────

export function getOption(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.options.get(name)?.at(-1);
}

export function getOptions(parsed: ParsedArgs, name: string): string[] {
  return parsed.options.get(name) ?? [];
}

export function hasOption(parsed: ParsedArgs, name: string): boolean {
  return parsed.options.has(name);
}

export function requireOption(parsed: ParsedArgs, name: string, helpText?: string): string {
  const value = getOption(parsed, name);
  if (!value || value === 'true') {
    throw new CliUsageError(helpText ?? `Missing required option --${name}.`);
  }
  return value;
}

export function requireOptionValue(parsed: ParsedArgs, name: string): string {
  const value = getOption(parsed, name);
  if (!value || value === 'true') {
    throw new CliUsageError(`--${name} requires a value.`);
  }
  return value;
}

export function optionalOptionValue(parsed: ParsedArgs, name: string): string | undefined {
  if (!hasOption(parsed, name)) return undefined;
  return requireOptionValue(parsed, name);
}

export function assertNoUnknownOptions(parsed: ParsedArgs, allowed: string[], context: string): void {
  const allowedOptions = new Set(allowed);
  const unknown = [...parsed.options.keys()].filter((name) => !allowedOptions.has(name));
  if (unknown.length === 0) return;

  const rendered = unknown.map((name) => `--${name}`).join(', ');
  const noun = unknown.length === 1 ? 'option' : 'options';
  throw new CliUsageError(`Unknown ${noun} for ${context}: ${rendered}`);
}

export function parsePositiveInt(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliUsageError(`--${optionName} must be a positive integer.`);
  }
  return parsed;
}

export function parseNonNegativeInt(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliUsageError(`--${optionName} must be a non-negative integer.`);
  }
  return parsed;
}

export function parseCsvValues(value: string, optionName: string): string[] {
  const parts = value.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new CliUsageError(`--${optionName} must contain at least one value.`);
  }
  return [...new Set(parts)];
}

export function printJson(runtime: Runtime, value: unknown): void {
  runtime.stdout(JSON.stringify(value, null, 2));
}

// ── API key resolution ─────────────────────────────────────────────

export function firstConfiguredApiKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.split(',').map((part) => part.trim()).find((part) => part.length > 0);
}

// ── Package root resolution ────────────────────────────────────────

const MAX_TRAVERSAL_DEPTH = 5;

export function resolvePackageRoot(importMetaUrl: string): string {
  let current = dirname(fileURLToPath(importMetaUrl));
  for (let depth = 0; depth < MAX_TRAVERSAL_DEPTH; depth += 1) {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    current = dirname(current);
  }
  throw new Error('Unable to resolve package root.');
}

export function readPackageVersion(): string {
  const packageRoot = resolvePackageRoot(import.meta.url);
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  return packageJson.version ?? '0.0.0';
}

// ── isMainModule ───────────────────────────────────────────────────

export function isMainModule(importMetaUrl: string, entrypoint: string | undefined = process.argv[1]): boolean {
  if (!entrypoint) return false;
  try {
    return importMetaUrl === pathToFileURL(realpathSync(entrypoint)).href;
  } catch {
    return importMetaUrl === pathToFileURL(entrypoint).href;
  }
}

// ── Error handling ─────────────────────────────────────────────────

function isCliDebugEnabled(runtime: Runtime): boolean {
  return runtime.env.CAMBRIAN_DEBUG === '1' || runtime.env.CAMBRIAN_DEBUG === 'true';
}

function formatRateLimitError(error: ApiError): string {
  const parts = ['Rate limit exceeded.'];
  if (error.rateLimit?.retryAfterSeconds) {
    parts.push(`Retry after ${error.rateLimit.retryAfterSeconds} seconds.`);
  }
  return parts.join(' ');
}

/**
 * A 401 means a key WAS sent but was rejected upstream — often surfaced only as
 * an HTML gateway page, whose sanitized message ("Upstream returned a non-JSON
 * (HTML) error response") reads like a network fault. Tell the user what it
 * actually is and how to fix it, mirroring the "API key required" wording.
 */
function formatAuthRequiredError(): string {
  return (
    'API key rejected (HTTP 401). The key sent with this request is invalid or expired.\n\n' +
    '  cambrian config get-key                  (inspect the stored key)\n' +
    '  cambrian config set-key <your-key>       (replace it, all shells)\n' +
    '  export CAMBRIAN_API_KEY=<your-key>       (current shell)\n\n' +
    'Get a key at: https://form.typeform.com/to/FlAoEzva'
  );
}

/** Emits a structured JSON error to stderr (used with the global --json flag). */
function logCliErrorJson(runtime: Runtime, error: unknown): void {
  if (error instanceof ApiError) {
    runtime.stderr(JSON.stringify({
      error: {
        code: error.code ?? null,
        message: error.message,
        status: error.status,
        retryable: error.retryable,
      },
    }));
    return;
  }
  if (error instanceof CliUsageError) {
    runtime.stderr(JSON.stringify({
      error: { code: 'USAGE_ERROR', message: error.message, status: null, retryable: false },
    }));
    return;
  }
  const message = error instanceof Error ? error.message : 'Unknown CLI error.';
  runtime.stderr(JSON.stringify({
    error: { code: 'CLI_ERROR', message, status: null, retryable: false },
  }));
}

export function logCliError(runtime: Runtime, error: unknown, json = false): void {
  if (json) {
    logCliErrorJson(runtime, error);
    return;
  }
  if (!(error instanceof Error)) {
    runtime.stderr('Unknown CLI error.');
    return;
  }
  if (!isCliDebugEnabled(runtime)) {
    if (error instanceof CliUsageError) {
      runtime.stderr(error.message);
      return;
    }
    if (error instanceof ApiError && error.status === 429) {
      runtime.stderr(formatRateLimitError(error));
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      runtime.stderr(formatAuthRequiredError());
      return;
    }
    runtime.stderr(error.message);
    return;
  }
  runtime.stderr(`${error.name}: ${error.message}`);
  if (error.stack) {
    runtime.stderr(error.stack);
  }
}

export function getCliExitCode(error: unknown): number {
  if (error instanceof CliUsageError) return 2;
  if (error instanceof ApiError && error.status === 400) return 2;
  return 1;
}
