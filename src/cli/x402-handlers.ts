/**
 * `cambrian pay <group> <resource> [params] [--max-amount <usd>] [--timeout <ms>] [--yes]` —
 * pay-per-call against the x402 gateway (x402.cambrian.network) instead of an
 * API key. Covers all data groups (solana / base|evm / deep42 / risk): the
 * gateway fronts the same `/api/v1/<group>/<resource>` paths. Reuses the bundled
 * metadata for resource/param validation, then pays via the @x402 SDK.
 *
 * Spends real USDC on Base; guarded by a spend cap, a cost preview, and --yes.
 */

import { createHash, randomUUID } from 'crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ParsedArgs, Runtime } from './core.js';
import {
  getOption,
  hasOption,
  requireOptionValue,
  optionalOptionValue,
  assertNoUnknownOptions,
  parseCsvValues,
  CliUsageError,
} from './core.js';
import { configDir, readConfig, writeConfig, type CambrianConfig } from './config.js';
import { didYouMean } from './suggest.js';
import { formatResult, OUTPUT_FORMATS, type OutputFormat } from './output.js';
import { coerceValue, deriveCliMetadata, serializeQueryParams } from './dynamic-handler.js';
import {
  CAMBRIAN_METADATA_GROUPS,
  DEEP42_RESOURCE_ALIASES,
  type CambrianGroup,
  type CambrianMetadataGroup,
  type GroupSpec,
} from '../metadata.js';
import {
  X402_BASE_URL,
  DEFAULT_MAX_AMOUNT_MICRO,
  usdToMicro,
  formatUsd,
  requirementAmount,
  type PaymentRequirement,
} from '../x402/payment.js';
import {
  payAndFetch,
  loadPayFetch,
  normalizePrivateKey,
  DEFAULT_X402_TIMEOUT_MS,
  X402_SDK_INSTALL_COMMAND,
} from '../x402/client.js';

const PAY_GLOBAL_OPTIONS = ['help', 'yes', 'max-amount', 'json', 'output', 'fields', 'timeout', 'offline'];
const X402_PENDING_GRACE_MS = 30_000;
const X402_PENDING_MIN_MS = 60_000;

type X402PendingRecord = NonNullable<CambrianConfig['x402PendingPayments']>[string];

/** group token (incl. evm alias) → { metadata group key, spec, aliases }. */
interface PayGroup {
  spec: GroupSpec;
  aliases: Record<string, string>;
  cliDefaults: Record<string, Record<string, string>>;
  allowedOptions: Record<string, string[]>;
}

function buildPayGroups(
  metadataGroups: Record<CambrianGroup, CambrianMetadataGroup>,
): Record<string, PayGroup> {
  const out: Record<string, PayGroup> = {};
  const build = (key: 'solana' | 'base' | 'deep42' | 'risk', aliases: Record<string, string>) => {
    const metadata = metadataGroups[key];
    const spec = metadata.spec;
    return {
      spec,
      aliases,
      cliDefaults: metadata.cliDefaults,
      allowedOptions: deriveCliMetadata(spec, metadata.cliDefaults).allowedOptions,
    };
  };
  out.solana = build('solana', {});
  out.base = build('base', {});
  out.evm = out.base; // alias
  out.deep42 = build('deep42', DEEP42_RESOURCE_ALIASES);
  out.risk = build('risk', {});
  return out;
}

function parseOutputFormat(parsed: ParsedArgs): OutputFormat {
  if (!hasOption(parsed, 'output')) return 'json';
  const raw = requireOptionValue(parsed, 'output');
  if (!OUTPUT_FORMATS.includes(raw as OutputFormat)) {
    throw new CliUsageError(`--output must be one of: ${OUTPUT_FORMATS.join(', ')}.`);
  }
  return raw as OutputFormat;
}

function parsePayTimeout(parsed: ParsedArgs): number {
  const raw = optionalOptionValue(parsed, 'timeout');
  if (!raw) return DEFAULT_X402_TIMEOUT_MS;
  const parsedMs = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsedMs) || parsedMs < 0) {
    throw new CliUsageError('--timeout must be a non-negative integer (milliseconds).');
  }
  return parsedMs;
}

function pendingWindowMs(req: PaymentRequirement): number {
  const timeoutSeconds = Number(req.maxTimeoutSeconds);
  const gatewayMs = Number.isFinite(timeoutSeconds) && timeoutSeconds >= 0
    ? Math.ceil(timeoutSeconds * 1000)
    : DEFAULT_X402_TIMEOUT_MS;
  return Math.max(X402_PENDING_MIN_MS, gatewayMs + X402_PENDING_GRACE_MS);
}

function removeExpiredPending(config: CambrianConfig, now: number): boolean {
  const pending = config.x402PendingPayments;
  if (!pending) return false;

  let changed = false;
  const next: NonNullable<CambrianConfig['x402PendingPayments']> = {};
  for (const [key, value] of Object.entries(pending)) {
    if (!value || typeof value.expiresAt !== 'number' || value.expiresAt <= now) {
      changed = true;
      continue;
    }
    next[key] = value;
  }

  if (!changed) return false;
  if (Object.keys(next).length > 0) {
    config.x402PendingPayments = next;
  } else {
    delete config.x402PendingPayments;
  }
  return true;
}

function pendingLockDir(runtime: Runtime): string {
  return join(configDir(runtime), 'x402-pending');
}

function pendingLockPath(runtime: Runtime, fingerprint: string): string {
  return join(pendingLockDir(runtime), `${fingerprint}.json`);
}

function readPendingLock(runtime: Runtime, fingerprint: string): X402PendingRecord | undefined {
  try {
    const parsed = JSON.parse(readFileSync(pendingLockPath(runtime, fingerprint), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as X402PendingRecord) : undefined;
  } catch {
    return undefined;
  }
}

function removePendingLock(runtime: Runtime, fingerprint: string): void {
  rmSync(pendingLockPath(runtime, fingerprint), { force: true });
}

function isAlreadyExistsError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST';
}

function pendingAttemptError(existing: X402PendingRecord): CliUsageError {
  return new CliUsageError(
    `x402: a previous paid attempt for this same wallet and resource is still pending until ` +
      `${new Date(existing.expiresAt).toISOString()}. Payment status may be unknown; ` +
      'check wallet activity before retrying.',
  );
}

function acquirePendingLock(
  runtime: Runtime,
  fingerprint: string,
  record: X402PendingRecord,
  now: number,
): void {
  mkdirSync(pendingLockDir(runtime), { recursive: true, mode: 0o700 });
  const lockPath = pendingLockPath(runtime, fingerprint);
  try {
    const fd = openSync(lockPath, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(record, null, 2) + '\n');
    } finally {
      closeSync(fd);
    }
    return;
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err;
  }

  const existing = readPendingLock(runtime, fingerprint);
  if (existing && existing.expiresAt > now) {
    throw pendingAttemptError(existing);
  }

  removePendingLock(runtime, fingerprint);
  const fd = openSync(lockPath, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(record, null, 2) + '\n');
  } finally {
    closeSync(fd);
  }
}

export function x402PendingFingerprint(
  privateKey: string,
  url: string,
  req: PaymentRequirement,
): string {
  const normalizedKey = normalizePrivateKey(privateKey).toLowerCase();
  return createHash('sha256')
    .update('cambrian-x402-pending-v1\0')
    .update(normalizedKey)
    .update('\0')
    .update(url)
    .update('\0')
    .update(requirementAmount(req))
    .update('\0')
    .update(req.network)
    .update('\0')
    .update(req.payTo.toLowerCase())
    .update('\0')
    .update(req.asset.toLowerCase())
    .digest('hex');
}

export function prepareX402PaymentAttempt(
  runtime: Runtime,
  privateKey: string,
  url: string,
  req: PaymentRequirement,
  now = Date.now(),
): {
  headers: Record<string, string>;
  onSuccess: () => void;
  onRejected: () => void;
  onUnknown: () => void;
} {
  const fingerprint = x402PendingFingerprint(privateKey, url, req);
  const config = readConfig(runtime);
  removeExpiredPending(config, now);

  const existing = config.x402PendingPayments?.[fingerprint];
  if (existing && existing.expiresAt > now) {
    throw pendingAttemptError(existing);
  }

  const idempotencyKey = randomUUID();
  const expiresAt = now + pendingWindowMs(req);
  const record = {
    idempotencyKey,
    createdAt: now,
    expiresAt,
    amount: requirementAmount(req),
    network: req.network,
    payTo: req.payTo,
  };
  acquirePendingLock(runtime, fingerprint, record, now);

  config.x402PendingPayments = {
    ...(config.x402PendingPayments ?? {}),
    [fingerprint]: record,
  };
  try {
    writeConfig(runtime, config);
  } catch (err) {
    removePendingLock(runtime, fingerprint);
    throw err;
  }

  const clearPending = () => {
    try {
      const latest = readConfig(runtime);
      const pending = latest.x402PendingPayments;
      const ownsConfigRecord = pending?.[fingerprint]?.idempotencyKey === idempotencyKey;
      const ownsLockRecord = readPendingLock(runtime, fingerprint)?.idempotencyKey === idempotencyKey;
      if (!ownsConfigRecord && !ownsLockRecord) return;

      if (ownsConfigRecord && pending) {
        delete pending[fingerprint];
        if (Object.keys(pending).length > 0) {
          latest.x402PendingPayments = pending;
        } else {
          delete latest.x402PendingPayments;
        }
        writeConfig(runtime, latest);
      }
      if (ownsLockRecord) removePendingLock(runtime, fingerprint);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      runtime.stderr(`x402: warning: could not clear local pending-payment guard: ${detail}`);
    }
  };

  return {
    headers: {
      'Idempotency-Key': idempotencyKey,
      'X-Cambrian-Idempotency-Key': idempotencyKey,
    },
    onSuccess: clearPending,
    onRejected: clearPending,
    onUnknown: () => {},
  };
}

export function payHelp(): string {
  return [
    'Usage:',
    '  cambrian pay <group> <resource> [params] [--max-amount <usd>] [--timeout <ms>] [--yes]',
    '',
    'Pay-per-call via x402 (Base USDC, $0.05/call) instead of an API key. Spends real funds.',
    '',
    'Groups:  solana | base (evm) | deep42 | risk',
    '',
    'Options:',
    '  --yes              Authorize the payment (required; otherwise prints a preview only).',
    '  --max-amount <usd> Spend cap per call (default 0.10).',
    `  --timeout <ms>    Gateway timeout in milliseconds (default ${DEFAULT_X402_TIMEOUT_MS}).`,
    '  --output <fmt>     json (default), table, or tsv.',
    '  --fields a,b,c     Project to only these fields.',
    '',
    'Wallet:',
    '  Set CAMBRIAN_X402_PRIVATE_KEY=0x<key> (Base mainnet, funded with USDC).',
    `  Requires the x402 SDK: ${X402_SDK_INSTALL_COMMAND}`,
    '',
    'Examples:',
    '  cambrian pay deep42 social-data/alpha-tweet-detection --limit 1 --yes',
    '  cambrian pay base price-current --token-address 0x4200000000000000000000000000000000000006 --yes',
  ].join('\n');
}

/** Joins the gateway base URL with an apiPath (which may lack a leading slash). */
function buildUrl(apiPath: string, query: URLSearchParams): string {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const qs = query.toString();
  return `${X402_BASE_URL}${path}${qs ? `?${qs}` : ''}`;
}

export async function handlePay(
  parsed: ParsedArgs,
  runtime: Runtime,
  metadataGroups: Record<CambrianGroup, CambrianMetadataGroup> = CAMBRIAN_METADATA_GROUPS,
): Promise<number> {
  const payGroups = buildPayGroups(metadataGroups);
  const groupArg = parsed.positionals[1];
  const resourceArg = parsed.positionals[2];
  if (!groupArg || hasOption(parsed, 'help')) {
    runtime.stdout(payHelp());
    return 0;
  }

  const group = payGroups[groupArg];
  if (!group) {
    const suggestion = didYouMean(groupArg, Object.keys(payGroups));
    throw new CliUsageError(
      `Unknown pay group: ${groupArg}.${suggestion} Groups: solana, base, deep42, risk.`,
    );
  }
  if (!resourceArg) {
    throw new CliUsageError(`Usage: cambrian pay ${groupArg} <resource> [params]. Run "cambrian pay --help".`);
  }

  const resource = group.aliases[resourceArg] ?? resourceArg;
  const entry = group.spec[resource];
  if (!entry) {
    const suggestion = didYouMean(resource, Object.keys(group.spec));
    throw new CliUsageError(`Unknown ${groupArg} resource: ${resourceArg}.${suggestion}`);
  }

  const allowed = group.allowedOptions[resource] ?? [];
  assertNoUnknownOptions(parsed, [...PAY_GLOBAL_OPTIONS, ...allowed], `pay ${groupArg} ${resourceArg}`);

  const queryParams: Record<string, unknown> = {};
  const defaults = group.cliDefaults[resource] ?? {};
  for (const [apiParam, paramSpec] of Object.entries(entry.params)) {
    const cliFlag = apiParam.replace(/_/g, '-');

    if (paramSpec.type === 'boolean') {
      if (hasOption(parsed, cliFlag)) {
        const rawBoolean = getOption(parsed, cliFlag);
        if (rawBoolean !== 'true' && rawBoolean !== 'false') {
          throw new CliUsageError(`--${cliFlag} must be true or false.`);
        }
        queryParams[apiParam] = rawBoolean === 'true';
      } else if (paramSpec.strict && paramSpec.default !== undefined) {
        queryParams[apiParam] = paramSpec.default;
      } else if (paramSpec.strict && paramSpec.required && paramSpec.default === undefined) {
        throw new CliUsageError(`Missing required option --${cliFlag}.`);
      }
      continue;
    }

    const rawValue = getOption(parsed, cliFlag);
    if (rawValue && rawValue !== 'true') {
      queryParams[apiParam] = coerceValue(rawValue, paramSpec, cliFlag);
    } else if (apiParam in defaults) {
      queryParams[apiParam] = coerceValue(defaults[apiParam], paramSpec, cliFlag);
    } else if (paramSpec.default !== undefined) {
      queryParams[apiParam] = paramSpec.strict
        ? paramSpec.default
        : coerceValue(String(paramSpec.default), paramSpec, cliFlag);
    } else if (paramSpec.required) {
      throw new CliUsageError(`Missing required option --${cliFlag}.`);
    }
  }
  const serialized = serializeQueryParams(entry, queryParams);
  const query = new URLSearchParams();
  for (const [apiParam, value] of Object.entries(serialized)) {
    if (Array.isArray(value)) {
      // Preserve the existing comma-separated pay behavior for the bundled
      // snapshot. Runtime additions honor their explicit OpenAPI serialization.
      if (!entry.params[apiParam]?.strict) {
        query.set(apiParam, String(value));
      } else {
        for (const item of value) query.append(apiParam, String(item));
      }
    } else {
      query.set(apiParam, String(value));
    }
  }
  const url = buildUrl(entry.apiPath, query);

  const privateKey = runtime.env.CAMBRIAN_X402_PRIVATE_KEY;
  if (!privateKey) {
    throw new CliUsageError(
      'x402 payments need a wallet key. Set it (Base mainnet, funded with USDC):\n\n' +
        '  export CAMBRIAN_X402_PRIVATE_KEY=0x<your-private-key>\n\n' +
        'The key is read only at runtime — never stored or logged.',
    );
  }

  const capMicro = hasOption(parsed, 'max-amount')
    ? usdToMicro(requireOptionValue(parsed, 'max-amount'))
    : DEFAULT_MAX_AMOUNT_MICRO;
  const authorized = hasOption(parsed, 'yes');
  const output = parseOutputFormat(parsed);
  const timeoutMs = parsePayTimeout(parsed);
  const fields = hasOption(parsed, 'fields')
    ? parseCsvValues(getOption(parsed, 'fields') ?? '', 'fields')
    : undefined;

  const result = await payAndFetch({
    fetch: runtime.fetch,
    url,
    capMicro,
    timeoutMs,
    getPayFetch: () => loadPayFetch(privateKey, runtime.fetch, capMicro),
    preparePayment: (req) => prepareX402PaymentAttempt(runtime, privateKey, url, req),
    onPreview: (req) => {
      runtime.stderr(
        `x402: price ${formatUsd(requirementAmount(req))} USDC on ${req.network} → payTo ${req.payTo}`,
      );
      runtime.stderr(`      resource: ${url}`);
      if (!authorized) {
        runtime.stderr('      preview only — re-run with --yes to authorize this payment.');
      }
    },
    authorize: () => authorized,
  });

  if (result.paid) {
    runtime.stderr(`x402: payment settled${result.receipt ? ' (receipt in payment-response)' : ''}.`);
  }

  const maxWidth =
    typeof process !== 'undefined' && process.stdout && typeof process.stdout.columns === 'number'
      ? process.stdout.columns
      : 80;
  try {
    runtime.stdout(formatResult(result.body, { output, fields, maxWidth }));
  } catch (err) {
    if (!result.paid) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    runtime.stderr(`x402: output formatting failed after payment settled: ${detail}`);
    runtime.stderr('x402: returning unfiltered JSON so the paid response is still delivered.');
    runtime.stdout(JSON.stringify(result.body, null, 2));
  }
  return 0;
}
