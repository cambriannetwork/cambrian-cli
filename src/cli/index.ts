import {
  parseArgs,
  createRuntime,
  getOption,
  getOptions,
  hasOption,
  optionalOptionValue,
  validateHttpUrl,
  requireOptionValue,
  assertNoUnknownOptions,
  assertNoExtraPositionals,
  readPackageVersion,
  firstConfiguredApiKey,
  logCliError,
  getCliExitCode,
  isMainModule,
  printJson,
  CliUsageError,
  parseNonNegativeInt,
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
import {
  DEFAULT_EVM_CHAIN,
  EVM_CHAINS,
  type EvmChain,
  discoverEvmChains,
  evmChainForToken,
  hasEvmChainSupport,
  isSyntheticEvmChainToken,
  projectEvmChain,
} from './evm-chains.js';

// ── Known top-level commands (for dispatch + typo suggestions) ──────

const EVM_COMMAND_TOKENS = EVM_CHAINS.map((chain) => chain.command);

const KNOWN_COMMANDS = ['solana', 'evm', ...EVM_COMMAND_TOKENS, 'deep42', 'risk', 'pay', 'docs', 'config', 'completion', 'schema', 'skill', 'mcp', 'describe'];

/** Command groups that perform real authenticated queries (drive the update notice). */
const DATA_COMMANDS = ['solana', 'evm', ...EVM_COMMAND_TOKENS, 'deep42', 'risk'];

/** Every chain command the active schema advertises, including `chain-<id>` discoveries. */
function activeEvmChains(runtime: Runtime): EvmChain[] {
  return discoverEvmChains(loadCachedMetadataGroup('base', runtime).metadata);
}

/** True for any token the EVM dispatcher can route (curated or `chain-<id>`). */
function isEvmChainCommand(command: string): boolean {
  return evmChainForToken(command) !== undefined;
}

const REGISTRY_GROUPS: CambrianGroup[] = ['solana', 'base', 'deep42', 'risk'];

function cachedMetadataGroups(runtime: Runtime): Record<CambrianGroup, CambrianMetadataGroup> {
  return Object.fromEntries(
    REGISTRY_GROUPS.map((group) => [group, loadCachedMetadataGroup(group, runtime).metadata]),
  ) as Record<CambrianGroup, CambrianMetadataGroup>;
}

function suggestionCommands(runtime: Runtime): string[] {
  const available = new Set(activeEvmChains(runtime).map((chain) => chain.command));
  return KNOWN_COMMANDS.filter((command) =>
    command !== 'evm' && (!EVM_COMMAND_TOKENS.includes(command) || available.has(command)));
}


function canonicalRegistryResource(group: CambrianGroup, resource: string): string {
  return group === 'deep42' ? DEEP42_RESOURCE_ALIASES[resource] ?? resource : resource;
}

function registryGroupForToken(group: string | undefined): CambrianGroup | undefined {
  if (group && evmChainForToken(group)) return 'base';
  if (group === 'solana' || group === 'deep42' || group === 'risk') return group;
  return undefined;
}

function projectEvmCommand(
  metadata: CambrianMetadataGroup,
  command: string,
): CambrianMetadataGroup {
  return projectEvmChain(metadata, evmChainForToken(command) ?? DEFAULT_EVM_CHAIN);
}

async function runtimeRootHelp(parsed: ParsedArgs, runtime: Runtime): Promise<string> {
  const metadata = await runtimeMetadataFor('base', '', parsed, runtime);
  return rootHelp(discoverEvmChains(metadata));
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
  return parseNonNegativeInt(raw, 'timeout', ' (milliseconds)');
}

function parseRetriesOption(parsed: ParsedArgs): number | undefined {
  const raw = optionalOptionValue(parsed, 'retries');
  if (!raw) return undefined;
  return parseNonNegativeInt(raw, 'retries');
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
      'Get an API key: https://console.cambrian.org/\n' +
      'No API key? Use x402 pay-per-call: cambrian pay --help\n' +
      'x402 guide: https://docs.cambrian.org/guides/x402/llms.txt',
    );
  }

  const timeoutMs = parseTimeoutOption(parsed);
  const maxRetries = parseRetriesOption(parsed);
  const baseUrlValue = optionalOptionValue(parsed, 'base-url');
  const baseUrl = baseUrlValue ? validateHttpUrl(baseUrlValue, 'base-url') : undefined;
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
  assertNoExtraPositionals(parsed, 3, 'docs');
  const group = parsed.positionals[1] ?? undefined;
  const resource = parsed.positionals[2] ?? undefined;
  assertNoUnknownOptions(parsed, ['help', 'offline'], 'docs');
  if (group === 'guides' && resource && !/^[a-z0-9][a-z0-9-]*$/.test(resource)) {
    throw new CliUsageError(
      'Guide name must use lowercase letters, numbers, and hyphens. ' +
      'Run "cambrian docs guides" to list available guides.',
    );
  }

  const metadataGroups = { ...CAMBRIAN_METADATA_GROUPS };
  const registryGroup = registryGroupForToken(group);
  if (registryGroup) {
    const metadata = await runtimeMetadataFor(
      registryGroup,
      resource ?? '',
      parsed,
      runtime,
    );
    metadataGroups[registryGroup] = registryGroup === 'base' && group
      ? projectEvmCommand(metadata, group)
      : metadata;
    const docsChain = group ? evmChainForToken(group) : undefined;
    if (docsChain && docsChain.command !== 'evm' && docsChain.command !== 'base') {
      if (metadataGroups.base.resources.length === 0) {
        throw new CliUsageError(
          `${docsChain.label} commands are not available in the active EVM schema yet.`,
        );
      }
      if (resource && !metadataGroups.base.spec[resource]) {
        const suggestion = didYouMean(resource, metadataGroups.base.resources);
        throw new CliUsageError(`Unknown ${docsChain.command} resource: ${resource}.${suggestion}`);
      }
    }
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

  // Live llms.txt unavailable — fall back to the active cached/bundled OpenAPI
  // metadata so the command still produces useful output offline.
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
  assertNoExtraPositionals(parsed, 2, resource ? `skill ${resource}` : 'skill');
  if (!resource || hasOption(parsed, 'help')) {
    assertNoUnknownOptions(parsed, ['help'], 'skill');
    runtime.stdout(skillHelp());
    return 0;
  }

  const allowedOptions: Record<string, string[]> = {
    install: ['help', 'tool', 'path'],
    print: ['help', 'adapter'],
    targets: ['help'],
  };
  assertNoUnknownOptions(parsed, allowedOptions[resource] ?? ['help'], `skill ${resource}`);

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
  assertNoExtraPositionals(parsed, sub === 'set-key' ? 3 : 2, sub ? `config ${sub}` : 'config');
  assertNoUnknownOptions(parsed, ['help'], sub ? `config ${sub}` : 'config');
  if (!sub || hasOption(parsed, 'help')) {
    runtime.stdout(configHelp());
    return 0;
  }

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
    case 'status': {
      const storedKey = Boolean(readConfig(runtime).apiKey);
      const environmentKey = Boolean(firstConfiguredApiKey(runtime.env.CAMBRIAN_API_KEY));
      printJson(runtime, {
        configured: environmentKey || storedKey,
        source: environmentKey ? 'CAMBRIAN_API_KEY' : storedKey ? 'stored config' : 'none',
        storedKey,
      });
      return 0;
    }
    case 'get-key': {
      const stored = readConfig(runtime).apiKey;
      if (!stored) {
        runtime.stderr('No API key stored. Set one with: cambrian config set-key <key>');
        return 1;
      }
      runtime.stderr(
        'Warning: this prints the full stored API key. Prefer "cambrian config status" for safe inspection.',
      );
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
      throw new CliUsageError(`Unknown config subcommand: ${sub}. Use status, set-key, get-key, or clear.`);
  }
}

// ── Completion command (static shell stubs + hidden __complete) ─────

async function handleCompletion(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const shell = parsed.positionals[1];
  assertNoExtraPositionals(parsed, 2, 'completion');
  assertNoUnknownOptions(parsed, ['help'], 'completion');
  if (!shell || hasOption(parsed, 'help')) {
    runtime.stdout(completionHelp());
    return 0;
  }
  runtime.stdout(completionScript(assertCompletionShell(shell)));
  return 0;
}

// ── Runtime schema registry controls ──────────────────────────────

function selectedSchemaGroups(token: string | undefined): CambrianGroup[] {
  if (!token) return [...REGISTRY_GROUPS];
  const group = registryGroupForToken(token);
  if (!group) {
    const valid = ['solana', ...EVM_COMMAND_TOKENS, 'deep42', 'risk'].join(', ');
    throw new CliUsageError(`Unknown schema group: ${token}. Use ${valid}.`);
  }
  return [group];
}

async function handleSchema(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const subcommand = parsed.positionals[1];
  assertNoExtraPositionals(parsed, 3, subcommand ? `schema ${subcommand}` : 'schema');
  assertNoUnknownOptions(
    parsed,
    subcommand === 'status' ? ['help', 'offline'] : ['help'],
    subcommand ? `schema ${subcommand}` : 'schema',
  );
  if (!subcommand || hasOption(parsed, 'help')) {
    runtime.stdout(schemaHelp(activeEvmChains(runtime)));
    return 0;
  }
  if (subcommand === 'chains') {
    assertNoExtraPositionals(parsed, 2, 'schema chains');
    // Refresh-aware: report what the active registry actually serves, so a
    // newly deployed chain shows up here without a CLI upgrade.
    const metadata = await runtimeMetadataFor('base', '', parsed, runtime);
    const discovered = discoverEvmChains(metadata);
    const rows = [
      // Curated chains, including any the active schema no longer advertises.
      ...EVM_CHAINS.map((chain) => {
        const projected = projectEvmChain(metadata, chain);
        return {
          command: chain.command,
          chainId: chain.chainId,
          label: chain.label,
          source: 'curated' as const,
          supported: hasEvmChainSupport(metadata, chain),
          resources: projected.resources,
        };
      }),
      // Advertised ids with no curated row, usable as `chain-<id>` today.
      ...discovered
        .filter((chain) => isSyntheticEvmChainToken(chain.command))
        .map((chain) => ({
          command: chain.command,
          chainId: chain.chainId,
          label: chain.label,
          source: 'discovered' as const,
          supported: true,
          resources: projectEvmChain(metadata, chain).resources,
        })),
    ];
    printJson(runtime, { chains: rows });
    return 0;
  }

  const groupToken = parsed.positionals[2];
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
    `Unknown schema subcommand: ${subcommand}. Use chains, status, refresh, or clear-cache.`,
  );
}

// ── Describe command ───────────────────────────────────────────────

async function handleDescribe(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const resource = parsed.positionals[1];
  assertNoExtraPositionals(parsed, 2, resource ? `describe ${resource}` : 'describe');
  assertNoUnknownOptions(
    parsed,
    resource === 'opencli' ? ['help', 'offline'] : ['help'],
    resource ? `describe ${resource}` : 'describe',
  );
  if (!resource || hasOption(parsed, 'help')) {
    runtime.stdout(describeHelp());
    return 0;
  }
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
      assertNoExtraPositionals(parsed, 0, 'cambrian --version');
      assertNoUnknownOptions(parsed, ['version'], 'cambrian --version');
      runtime.stdout(readPackageVersion());
      return 0;
    }

    const command = parsed.positionals[0];
    if (
      command === 'evm' ||
      ((command === 'pay' || command === 'docs') && parsed.positionals[1] === 'evm') ||
      (command === 'schema' && parsed.positionals[2] === 'evm')
    ) {
      runtime.stderr('Warning: "evm" is deprecated. Use "base" for Base chain 8453.');
    }

    // No args → human landing screen (banner only for interactive terminals)
    if (!command) {
      assertNoUnknownOptions(parsed, ['help'], 'cambrian');
      if (runtime.isTTY) {
        runtime.stdout(banner(runtime.env.NO_COLOR ? 'none' : 'gradient'));
        runtime.stdout('');
      }
      runtime.stdout(await runtimeRootHelp(parsed, runtime));
      return 0;
    }

    // `chain-<id>` tokens are resolved from the active schema, so they are
    // valid data commands even though KNOWN_COMMANDS is static.
    const isEvmChain = isEvmChainCommand(command);

    // --help with no recognized command → root help
    if (hasOption(parsed, 'help') && !KNOWN_COMMANDS.includes(command) && !isEvmChain) {
      runtime.stdout(await runtimeRootHelp(parsed, runtime));
      return 0;
    }

    const resource = parsed.positionals[1] ?? '';
    const isDataCommand = DATA_COMMANDS.includes(command) || isEvmChain;
    if (isDataCommand) {
      assertNoExtraPositionals(parsed, 2, resource ? `${command} ${resource}` : command);
    }
    const wantsHelp = hasOption(parsed, 'help');
    const noResource = !resource;
    const skipAuth = noResource || wantsHelp;

    // Gentle "update available" nudge on real queries — stderr only, throttled,
    // suppressed for non-TTY/CI so piped output and agents are never affected.
    if (isDataCommand && !skipAuth) {
      maybeNotifyUpdate(runtime, readPackageVersion());
    }

    // Shared EVM execution for curated chains and runtime `chain-<id>` tokens.
    const runEvmCommand = async (chainToken: string): Promise<number> => {
      const chain = evmChainForToken(chainToken) ?? DEFAULT_EVM_CHAIN;
      const metadata = projectEvmCommand(
        await runtimeMetadataFor('base', resource, parsed, runtime),
        chainToken,
      );
      // Base owns chain-neutral endpoints; every other chain only appears when
      // the active schema explicitly advertises its chain id.
      if (chain.chainId !== DEFAULT_EVM_CHAIN.chainId && metadata.resources.length === 0) {
        if (isSyntheticEvmChainToken(chainToken)) {
          throw new CliUsageError(
            `${chain.label} is not advertised by the active EVM schema. ` +
            'Run "cambrian schema chains" to list supported chains.',
          );
        }
        throw new CliUsageError(
          `${chain.label} commands are not available in the active EVM schema yet. ` +
          'Use "cambrian base --help" for currently supported EVM commands.',
        );
      }
      if (skipAuth) {
        return await handleEvmQuery(resource, parsed, runtime, null!, metadata, chain.command);
      }
      const client = createClient(parsed, runtime);
      return await handleEvmQuery(resource, parsed, runtime, client, metadata, chain.command);
    };

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
      case 'base':
      case 'ethereum':
      case 'arbitrum':
        return await runEvmCommand(command);
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
          const metadata = await runtimeMetadataFor('base', '', parsed, runtime);
          runtime.stdout(docsHelp(discoverEvmChains(metadata)));
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
        // Runtime-discovered `chain-<id>` tokens route through the EVM path.
        if (isEvmChain) {
          return await runEvmCommand(command);
        }
        const suggestion = didYouMean(command, suggestionCommands(runtime));
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
