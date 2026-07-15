import {
  parseArgs,
  createRuntime,
  getOption,
  getOptions,
  hasOption,
  optionalOptionValue,
  requireOptionValue,
  assertNoUnknownOptions,
  readPackageVersion,
  firstConfiguredApiKey,
  logCliError,
  getCliExitCode,
  isMainModule,
  printJson,
  CliUsageError,
} from './core.js';
import type { ParsedArgs, Runtime } from './core.js';
import { CambrianData } from '../client/index.js';
import { handleSolanaQuery } from './solana-handlers.js';
import { handleEvmQuery } from './evm-handlers.js';
import { handleDeep42Query } from './deep42-handlers.js';
import { handleRiskQuery } from './risk-handlers.js';
import { rootHelp, skillHelp, describeHelp, docsHelp, schemaHelp } from './help.js';
import { banner } from './banner.js';
import { buildOpenCliDocument } from './opencli.js';
import { fetchDocs, buildSchemaFallbackDocs } from './docs-fetcher.js';
import { didYouMean } from './suggest.js';
import { handleMcp, mcpHelp } from './mcp.js';
import {
  installSkill,
  readSkillMarkdown,
  readSkillAdapter,
  listSkillTargets,
  INSTALLABLE_SKILL_TOOLS,
  SKILL_ADAPTERS,
} from './skill.js';
import { handlePay } from './x402-handlers.js';
import { readConfig, writeConfig, configPath } from './config.js';
import { complete, completionScript, assertCompletionShell } from './completion.js';
import { maybeNotifyUpdate } from './update-check.js';
import { configHelp, completionHelp } from './help.js';
import {
  loadCachedMetadataGroup,
  loadRuntimeMetadataGroup,
  clearRegistryCache,
} from '../schema/registry.js';
import {
  CAMBRIAN_METADATA_GROUPS,
  DEEP42_RESOURCE_ALIASES,
  type CambrianGroup,
  type CambrianMetadataGroup,
} from '../metadata.js';

// ── Known top-level commands (for dispatch + typo suggestions) ──────

const KNOWN_COMMANDS = ['solana', 'evm', 'base', 'deep42', 'risk', 'pay', 'docs', 'config', 'completion', 'schema', 'skill', 'mcp', 'describe'];

/** Command groups that perform real authenticated queries (drive the update notice). */
const DATA_COMMANDS = ['solana', 'evm', 'base', 'deep42', 'risk'];

const REGISTRY_GROUPS: CambrianGroup[] = ['solana', 'base', 'deep42', 'risk'];

function cachedMetadataGroups(runtime: Runtime): Record<CambrianGroup, CambrianMetadataGroup> {
  return Object.fromEntries(
    REGISTRY_GROUPS.map((group) => [group, loadCachedMetadataGroup(group, runtime).metadata]),
  ) as Record<CambrianGroup, CambrianMetadataGroup>;
}

function canonicalRegistryResource(group: CambrianGroup, resource: string): string {
  return group === 'deep42' ? DEEP42_RESOURCE_ALIASES[resource] ?? resource : resource;
}

function registryGroupForToken(group: string | undefined): CambrianGroup | undefined {
  if (group === 'evm' || group === 'base') return 'base';
  if (group === 'solana' || group === 'deep42' || group === 'risk') return group;
  return undefined;
}

async function runtimeMetadataFor(
  group: CambrianGroup,
  resource: string,
  parsed: ParsedArgs,
  runtime: Runtime,
): Promise<CambrianMetadataGroup> {
  const resolution = await loadRuntimeMetadataGroup(group, runtime, {
    offline: hasOption(parsed, 'offline'),
    ...(resource ? { missingResource: canonicalRegistryResource(group, resource) } : {}),
  });
  return resolution.metadata;
}

async function allRuntimeMetadata(
  parsed: ParsedArgs,
  runtime: Runtime,
): Promise<Record<CambrianGroup, CambrianMetadataGroup>> {
  const entries = await Promise.all(
    REGISTRY_GROUPS.map(async (group) => {
      const resolution = await loadRuntimeMetadataGroup(group, runtime, {
        offline: hasOption(parsed, 'offline'),
      });
      return [group, resolution.metadata] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<CambrianGroup, CambrianMetadataGroup>;
}

// ── Client factory ─────────────────────────────────────────────────

function parseTimeoutOption(parsed: ParsedArgs): number | undefined {
  const raw = optionalOptionValue(parsed, 'timeout');
  if (!raw) return undefined;
  const parsedMs = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsedMs) || parsedMs < 0) {
    throw new CliUsageError('--timeout must be a non-negative integer (milliseconds).');
  }
  return parsedMs;
}

function parseRetriesOption(parsed: ParsedArgs): number | undefined {
  const raw = optionalOptionValue(parsed, 'retries');
  if (!raw) return undefined;
  const count = Number.parseInt(raw, 10);
  if (!Number.isInteger(count) || count < 0) {
    throw new CliUsageError('--retries must be a non-negative integer.');
  }
  return count;
}

/**
 * Resolves the API key by precedence: `--api-key` → `CAMBRIAN_API_KEY` → the
 * persisted config file (`cambrian config set-key`). Returns undefined if none.
 */
function resolveApiKey(parsed: ParsedArgs, runtime: Runtime): string | undefined {
  const flag = optionalOptionValue(parsed, 'api-key');
  if (flag) return flag;

  const fromEnv = firstConfiguredApiKey(runtime.env.CAMBRIAN_API_KEY);
  if (fromEnv) return fromEnv;

  const stored = readConfig(runtime).apiKey;
  if (stored && stored.length > 0) return stored;

  return undefined;
}

function createClient(parsed: ParsedArgs, runtime: Runtime): CambrianData {
  const apiKey = resolveApiKey(parsed, runtime);

  if (!apiKey) {
    throw new CliUsageError(
      'API key required. Set it with:\n\n' +
      '  cambrian config set-key <your-key>      (persisted, all shells)\n' +
      '  export CAMBRIAN_API_KEY=<your-key>       (current shell)\n\n' +
      'Or pass per-command:\n\n' +
      '  cambrian solana latest-block --api-key <your-key>\n\n' +
      'Get a key at: https://form.typeform.com/to/FlAoEzva',
    );
  }

  const timeoutMs = parseTimeoutOption(parsed);
  const maxRetries = parseRetriesOption(parsed);
  const baseUrl = optionalOptionValue(parsed, 'base-url');
  return new CambrianData({
    apiKey,
    opabiniaBaseUrl: baseUrl,
    deep42BaseUrl: baseUrl,
    riskBaseUrl: baseUrl,
    fetch: runtime.fetch,
    timeoutMs,
    maxRetries,
  });
}

// ── Docs command (fetches live from docs.cambrian.org/llms.txt) ───

async function handleDocs(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const group = parsed.positionals[1] ?? undefined;
  const resource = parsed.positionals[2] ?? undefined;
  assertNoUnknownOptions(parsed, ['help', 'offline'], 'docs');

  const metadataGroups = { ...CAMBRIAN_METADATA_GROUPS };
  const registryGroup = registryGroupForToken(group);
  if (registryGroup) {
    metadataGroups[registryGroup] = await runtimeMetadataFor(
      registryGroup,
      resource ?? '',
      parsed,
      runtime,
    );
  }

  const docs = await fetchDocs(
    runtime.fetch,
    group,
    resource,
    metadataGroups,
    hasOption(parsed, 'offline'),
  );
  if (docs) {
    runtime.stdout(docs);
    return 0;
  }

  // Live llms.txt unavailable — fall back to the bundled OpenAPI schema so the
  // command still produces useful, non-breaking output offline.
  const fallback = buildSchemaFallbackDocs(group, resource, metadataGroups);
  if (fallback) {
    runtime.stdout(fallback);
    return 0;
  }

  runtime.stderr('Could not fetch documentation. Check your network connection.');
  runtime.stderr('Docs: https://docs.cambrian.org/llms.txt');
  return 0;
}

// ── Skill command ──────────────────────────────────────────────────

function assertAcceptedSkillValue(value: string, optionName: string, accepted: readonly string[]): string {
  const normalized = value.trim().toLowerCase();
  if ((accepted as readonly string[]).includes(normalized)) return normalized;
  throw new CliUsageError(`--${optionName} must be one of: ${accepted.join(', ')}.`);
}

async function handleSkill(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const resource = parsed.positionals[1];
  if (!resource || hasOption(parsed, 'help')) {
    runtime.stdout(skillHelp());
    return 0;
  }

  assertNoUnknownOptions(parsed, ['help', 'tool', 'path', 'adapter'], `skill ${resource}`);

  switch (resource) {
    case 'install': {
      const tools = getOptions(parsed, 'tool').map((value) =>
        assertAcceptedSkillValue(value, 'tool', INSTALLABLE_SKILL_TOOLS),
      );
      const paths = getOptions(parsed, 'path').map((value) => {
        if (!value || value === 'true') throw new CliUsageError('--path requires a value.');
        return value;
      });
      const result = installSkill({
        tools,
        paths,
        homedir: runtime.homedir,
      });
      printJson(runtime, {
        ...result,
        authentication: {
          required_for_live_queries: true,
          accepted_flag: '--api-key',
          accepted_env_vars: ['CAMBRIAN_API_KEY'],
          note: 'Installing the skill bundle does not provision API access. Agents and CLI queries still need a valid API key in their runtime.',
        },
      });
      return 0;
    }
    case 'print': {
      if (!hasOption(parsed, 'adapter')) {
        runtime.stdout(readSkillMarkdown());
        return 0;
      }
      runtime.stdout(
        readSkillAdapter(
          assertAcceptedSkillValue(requireOptionValue(parsed, 'adapter'), 'adapter', SKILL_ADAPTERS),
        ),
      );
      return 0;
    }
    case 'targets':
      printJson(runtime, {
        targets: listSkillTargets({ homedir: runtime.homedir }),
      });
      return 0;
    default:
      throw new CliUsageError(`Unknown skill subcommand: ${resource}`);
  }
}

// ── Config command (persisted API key; XDG/0600) ───────────────────

async function handleConfig(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const sub = parsed.positionals[1];
  if (!sub || hasOption(parsed, 'help')) {
    runtime.stdout(configHelp());
    return 0;
  }
  assertNoUnknownOptions(parsed, ['help'], `config ${sub}`);

  switch (sub) {
    case 'set-key': {
      const key = parsed.positionals[2];
      if (!key) throw new CliUsageError('Usage: cambrian config set-key <key>');
      const config = readConfig(runtime);
      config.apiKey = key;
      writeConfig(runtime, config);
      runtime.stdout(`API key saved to ${configPath(runtime)}`);
      return 0;
    }
    case 'get-key': {
      const stored = readConfig(runtime).apiKey;
      if (!stored) {
        runtime.stderr('No API key stored. Set one with: cambrian config set-key <key>');
        return 1;
      }
      runtime.stdout(stored);
      return 0;
    }
    case 'clear': {
      const config = readConfig(runtime);
      delete config.apiKey;
      writeConfig(runtime, config);
      runtime.stdout('Stored API key cleared.');
      return 0;
    }
    default:
      throw new CliUsageError(`Unknown config subcommand: ${sub}. Use set-key, get-key, or clear.`);
  }
}

// ── Completion command (static shell stubs + hidden __complete) ─────

async function handleCompletion(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const shell = parsed.positionals[1];
  if (!shell || hasOption(parsed, 'help')) {
    runtime.stdout(completionHelp());
    return 0;
  }
  assertNoUnknownOptions(parsed, ['help'], 'completion');
  runtime.stdout(completionScript(assertCompletionShell(shell)));
  return 0;
}

// ── Runtime schema registry controls ──────────────────────────────

function selectedSchemaGroups(token: string | undefined): CambrianGroup[] {
  if (!token) return [...REGISTRY_GROUPS];
  const group = registryGroupForToken(token);
  if (!group) {
    throw new CliUsageError(
      `Unknown schema group: ${token}. Use solana, base, deep42, or risk.`,
    );
  }
  return [group];
}

async function handleSchema(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const subcommand = parsed.positionals[1];
  if (!subcommand || hasOption(parsed, 'help')) {
    runtime.stdout(schemaHelp());
    return 0;
  }
  assertNoUnknownOptions(parsed, ['help'], `schema ${subcommand}`);
  const groupToken = parsed.positionals[2];
  if (parsed.positionals.length > 3) {
    throw new CliUsageError(`Too many arguments for schema ${subcommand}.`);
  }
  const groups = selectedSchemaGroups(groupToken);

  if (subcommand === 'clear-cache') {
    const cleared = groups.length === 1
      ? clearRegistryCache(runtime, groups[0])
      : clearRegistryCache(runtime);
    printJson(runtime, {
      cleared,
      group: groups.length === 1 ? groups[0] : 'all',
    });
    return 0;
  }

  if (subcommand === 'status') {
    const statuses = groups.map((group) => loadCachedMetadataGroup(group, runtime).status);
    printJson(runtime, statuses.length === 1 ? statuses[0] : { groups: statuses });
    return 0;
  }

  if (subcommand === 'refresh') {
    const statuses = await Promise.all(
      groups.map(async (group) =>
        (await loadRuntimeMetadataGroup(group, runtime, { refresh: true })).status,
      ),
    );
    printJson(runtime, statuses.length === 1 ? statuses[0] : { groups: statuses });
    return statuses.some((status) => status.lastError) ? 1 : 0;
  }

  throw new CliUsageError(
    `Unknown schema subcommand: ${subcommand}. Use status, refresh, or clear-cache.`,
  );
}

// ── Describe command ───────────────────────────────────────────────

async function handleDescribe(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const resource = parsed.positionals[1];
  if (!resource || hasOption(parsed, 'help')) {
    runtime.stdout(describeHelp());
    return 0;
  }
  assertNoUnknownOptions(parsed, ['help', 'offline'], `describe ${resource}`);
  if (resource !== 'opencli') {
    throw new CliUsageError(`Unknown describe subcommand: ${resource}`);
  }
  printJson(runtime, buildOpenCliDocument(await allRuntimeMetadata(parsed, runtime)));
  return 0;
}

// ── Main dispatch ──────────────────────────────────────────────────

export async function runCli(argv: string[], runtimeOverrides: Partial<Runtime> = {}): Promise<number> {
  const runtime = createRuntime(runtimeOverrides);
  try {
    // Hidden completion endpoint: parse the raw words (which may include partial
    // flags) directly, before parseArgs, so it never errors on in-progress input.
    if (argv[0] === '__complete') {
      const candidates = complete(argv.slice(1), cachedMetadataGroups(runtime));
      if (candidates.length > 0) runtime.stdout(candidates.join('\n'));
      return 0;
    }

    const parsed = parseArgs(argv);

    if (hasOption(parsed, 'version')) {
      runtime.stdout(readPackageVersion());
      return 0;
    }

    const command = parsed.positionals[0];

    // No args → human landing screen (banner only for interactive terminals)
    if (!command) {
      if (runtime.isTTY) {
        runtime.stdout(banner(runtime.env.NO_COLOR ? 'none' : 'gradient'));
        runtime.stdout('');
      }
      runtime.stdout(rootHelp());
      return 0;
    }

    // --help with no recognized command → root help
    if (hasOption(parsed, 'help') && !KNOWN_COMMANDS.includes(command)) {
      runtime.stdout(rootHelp());
      return 0;
    }

    const resource = parsed.positionals[1] ?? '';
    const wantsHelp = hasOption(parsed, 'help');
    const noResource = !resource;
    const skipAuth = (noResource || wantsHelp) && !hasOption(parsed, 'discover');

    // Gentle "update available" nudge on real queries — stderr only, throttled,
    // suppressed for non-TTY/CI so piped output and agents are never affected.
    if (DATA_COMMANDS.includes(command) && !skipAuth) {
      maybeNotifyUpdate(runtime, readPackageVersion());
    }

    switch (command) {
      // ── Data commands ────────────────────────────────────────
      case 'solana': {
        if (skipAuth) {
          const metadata = await runtimeMetadataFor('solana', resource, parsed, runtime);
          return await handleSolanaQuery(resource, parsed, runtime, null!, metadata);
        }
        const client = createClient(parsed, runtime);
        const metadata = await runtimeMetadataFor('solana', resource, parsed, runtime);
        return await handleSolanaQuery(resource, parsed, runtime, client, metadata);
      }
      case 'evm':
      case 'base': {
        if (skipAuth) {
          const metadata = await runtimeMetadataFor('base', resource, parsed, runtime);
          return await handleEvmQuery(resource, parsed, runtime, null!, metadata);
        }
        const client = createClient(parsed, runtime);
        const metadata = await runtimeMetadataFor('base', resource, parsed, runtime);
        return await handleEvmQuery(resource, parsed, runtime, client, metadata);
      }
      case 'deep42': {
        if (skipAuth) {
          const metadata = await runtimeMetadataFor('deep42', resource, parsed, runtime);
          return await handleDeep42Query(resource, parsed, runtime, null!, metadata);
        }
        const client = createClient(parsed, runtime);
        const metadata = await runtimeMetadataFor('deep42', resource, parsed, runtime);
        return await handleDeep42Query(resource, parsed, runtime, client, metadata);
      }
      case 'risk': {
        if (skipAuth) {
          const metadata = await runtimeMetadataFor('risk', resource, parsed, runtime);
          return await handleRiskQuery(resource, parsed, runtime, null!, metadata);
        }
        const client = createClient(parsed, runtime);
        const metadata = await runtimeMetadataFor('risk', resource, parsed, runtime);
        return await handleRiskQuery(resource, parsed, runtime, client, metadata);
      }

      // ── x402 pay-per-call (Base USDC; spends real funds) ─────
      case 'pay': {
        const payGroupToken = parsed.positionals[1];
        const payResource = parsed.positionals[2] ?? '';
        const payGroup = registryGroupForToken(payGroupToken);
        if (!payGroup || !payResource || hasOption(parsed, 'help')) {
          return await handlePay(parsed, runtime);
        }
        const metadataGroups = { ...CAMBRIAN_METADATA_GROUPS };
        const cached = loadCachedMetadataGroup(payGroup, runtime).metadata;
        const canonicalResource = canonicalRegistryResource(payGroup, payResource);
        metadataGroups[payGroup] = cached.spec[canonicalResource]
          ? cached
          : await runtimeMetadataFor(payGroup, payResource, parsed, runtime);
        return await handlePay(parsed, runtime, metadataGroups);
      }

      // ── Docs: live API documentation from llms.txt ───────────
      case 'docs':
        if (hasOption(parsed, 'help')) {
          runtime.stdout(docsHelp());
          return 0;
        }
        return await handleDocs(parsed, runtime);

      // ── Config & completion ──────────────────────────────────
      case 'config':
        return await handleConfig(parsed, runtime);
      case 'completion':
        return await handleCompletion(parsed, runtime);
      case 'schema':
        return await handleSchema(parsed, runtime);

      // ── Meta commands ────────────────────────────────────────
      case 'skill':
        return await handleSkill(parsed, runtime);
      case 'mcp':
        if (hasOption(parsed, 'help') && !resource) {
          runtime.stdout(mcpHelp());
          return 0;
        }
        return await handleMcp(parsed, runtime);
      case 'describe':
        return await handleDescribe(parsed, runtime);
      default: {
        const suggestion = didYouMean(command, KNOWN_COMMANDS);
        throw new CliUsageError(
          `Unknown command: ${command}.${suggestion} Run "cambrian --help" for a list.`,
        );
      }
    }
  } catch (error) {
    logCliError(runtime, error, wantsJsonError(argv));
    return getCliExitCode(error);
  }
}

/**
 * Detects the global --json flag directly from argv. We parse argv here (rather
 * than relying on the parsed options) so that even errors thrown during arg
 * parsing are reported as structured JSON when --json was requested.
 */
function wantsJsonError(argv: string[]): boolean {
  return argv.some((token) => token === '--json' || token === '--json=true');
}

if (isMainModule(import.meta.url)) {
  const exitCode = await runCli(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
