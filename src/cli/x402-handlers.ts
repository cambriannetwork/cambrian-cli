/**
 * `cambrian pay <group> <resource> [params] [--max-amount <usd>] [--timeout <ms>] [--yes]` —
 * pay-per-call against the x402 gateway (x402.cambrian.network) instead of an
 * API key. Covers all data groups (solana / base|evm / deep42 / risk): the
 * gateway fronts the same `/api/v1/<group>/<resource>` paths. Reuses the bundled
 * metadata for resource/param validation, then pays via the @x402 SDK.
 *
 * Spends real USDC on Base; guarded by a spend cap, a cost preview, and --yes.
 */

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
import { didYouMean } from './suggest.js';
import { formatResult, OUTPUT_FORMATS, type OutputFormat } from './output.js';
import { deriveCliMetadata } from './dynamic-handler.js';
import {
  CAMBRIAN_METADATA_GROUPS,
  DEEP42_RESOURCE_ALIASES,
  type GroupSpec,
} from '../metadata.js';
import {
  X402_BASE_URL,
  DEFAULT_MAX_AMOUNT_MICRO,
  usdToMicro,
  formatUsd,
  requirementAmount,
} from '../x402/payment.js';
import {
  payAndFetch,
  loadPayFetch,
  DEFAULT_X402_TIMEOUT_MS,
  X402_SDK_INSTALL_COMMAND,
} from '../x402/client.js';

const PAY_GLOBAL_OPTIONS = ['help', 'yes', 'max-amount', 'json', 'output', 'fields', 'timeout'];

/** group token (incl. evm alias) → { metadata group key, spec, aliases }. */
interface PayGroup {
  spec: GroupSpec;
  aliases: Record<string, string>;
  allowedOptions: Record<string, string[]>;
}

const PAY_GROUPS: Record<string, PayGroup> = (() => {
  const out: Record<string, PayGroup> = {};
  const build = (key: 'solana' | 'base' | 'deep42' | 'risk', aliases: Record<string, string>) => {
    const spec = CAMBRIAN_METADATA_GROUPS[key].spec;
    return { spec, aliases, allowedOptions: deriveCliMetadata(spec, {}).allowedOptions };
  };
  out.solana = build('solana', {});
  out.base = build('base', {});
  out.evm = out.base; // alias
  out.deep42 = build('deep42', DEEP42_RESOURCE_ALIASES);
  out.risk = build('risk', {});
  return out;
})();

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

export async function handlePay(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const groupArg = parsed.positionals[1];
  const resourceArg = parsed.positionals[2];
  if (!groupArg || hasOption(parsed, 'help')) {
    runtime.stdout(payHelp());
    return 0;
  }

  const group = PAY_GROUPS[groupArg];
  if (!group) {
    const suggestion = didYouMean(groupArg, Object.keys(PAY_GROUPS));
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

  const query = new URLSearchParams();
  for (const apiParam of Object.keys(entry.params)) {
    const value = getOption(parsed, apiParam.replace(/_/g, '-'));
    if (value !== undefined && value !== 'true') query.set(apiParam, value);
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
  runtime.stdout(formatResult(result.body, { output, fields, maxWidth }));
  return 0;
}
