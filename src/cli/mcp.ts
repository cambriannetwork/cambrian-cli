import { spawnSync } from 'child_process';
import type { ParsedArgs, Runtime } from './core.js';
import {
  assertNoUnknownOptions,
  firstConfiguredApiKey,
  getOption,
  hasOption,
  requireOptionValue,
  printJson,
  CliUsageError,
} from './core.js';
import {
  CAMBRIAN_HOSTED_MCP_URL,
  CAMBRIAN_MCP_PACKAGE,
  CAMBRIAN_MCP_SERVER_NAME,
} from '../metadata.js';

const MCP_CLIENTS = ['claude', 'cursor', 'codex'] as const;
const MCP_MODES = ['hosted', 'local'] as const;

type McpClient = typeof MCP_CLIENTS[number];
type McpMode = typeof MCP_MODES[number];

interface McpServerConfig {
  type?: 'http';
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

function normalizeChoice<T extends readonly string[]>(
  value: string | undefined,
  accepted: T,
  fallback: T[number],
  optionName: string,
): T[number] {
  if (!value) return fallback;
  if (value === 'true') throw new CliUsageError(`--${optionName} requires a value.`);
  const normalized = value.trim().toLowerCase();
  if ((accepted as readonly string[]).includes(normalized)) return normalized as T[number];
  throw new CliUsageError(`--${optionName} must be one of: ${accepted.join(', ')}.`);
}

function resolveClient(parsed: ParsedArgs): McpClient {
  return normalizeChoice(getOption(parsed, 'client'), MCP_CLIENTS, 'claude', 'client');
}

function resolveMode(parsed: ParsedArgs): McpMode {
  return normalizeChoice(getOption(parsed, 'mode'), MCP_MODES, 'hosted', 'mode');
}

function resolveHostedUrl(parsed: ParsedArgs): string {
  if (!hasOption(parsed, 'url')) return CAMBRIAN_HOSTED_MCP_URL;
  return requireOptionValue(parsed, 'url');
}

function configApiKeyPlaceholder(): string {
  return '${CAMBRIAN_API_KEY}';
}

function resolveInstallApiKey(parsed: ParsedArgs, runtime: Runtime): string {
  const apiKey = hasOption(parsed, 'api-key')
    ? requireOptionValue(parsed, 'api-key')
    : firstConfiguredApiKey(runtime.env.CAMBRIAN_API_KEY);
  if (!apiKey || apiKey === 'true') {
    throw new CliUsageError(
      'CAMBRIAN_API_KEY required for mcp install/test. Set CAMBRIAN_API_KEY or pass --api-key <key>.',
    );
  }
  return apiKey;
}

function buildServerConfig(
  mode: McpMode,
  parsed: ParsedArgs,
  options: { includeSecret?: boolean; apiKey?: string } = {},
): McpServerConfig {
  const apiKeyValue = options.includeSecret && options.apiKey ? options.apiKey : configApiKeyPlaceholder();
  if (mode === 'hosted') {
    return {
      type: 'http',
      url: resolveHostedUrl(parsed),
      headers: {
        Authorization: `Bearer ${apiKeyValue}`,
      },
    };
  }
  return {
    command: 'npx',
    args: ['-y', CAMBRIAN_MCP_PACKAGE],
    env: {
      CAMBRIAN_API_KEY: apiKeyValue,
    },
  };
}

function buildClientConfig(client: McpClient, mode: McpMode, parsed: ParsedArgs): unknown {
  const serverConfig = buildServerConfig(mode, parsed);
  switch (client) {
    case 'claude':
    case 'cursor':
      return {
        mcpServers: {
          [CAMBRIAN_MCP_SERVER_NAME]: serverConfig,
        },
      };
    case 'codex':
      return {
        mcp_servers: {
          [CAMBRIAN_MCP_SERVER_NAME]: serverConfig,
        },
      };
  }
}

function extractMcpJsonResponse(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error('Empty MCP response.');
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLine = trimmed
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data: '));
  if (!dataLine) throw new Error('MCP response did not contain JSON or SSE data.');
  return JSON.parse(dataLine.slice('data: '.length));
}

async function testHosted(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const apiKey = resolveInstallApiKey(parsed, runtime);
  const response = await runtime.fetch(resolveHostedUrl(parsed), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
      id: 1,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Hosted MCP test failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const parsedResponse = extractMcpJsonResponse(text) as {
    result?: { tools?: { name: string }[] };
  };
  const tools = parsedResponse.result?.tools ?? [];
  const expectedTool = 'cambrian_base_chains';
  if (!tools.some((tool) => tool.name === expectedTool)) {
    throw new Error(`Hosted MCP test did not find expected tool ${expectedTool}.`);
  }
  printJson(runtime, {
    ok: true,
    mode: 'hosted',
    url: resolveHostedUrl(parsed),
    toolCount: tools.length,
    checkedTool: expectedTool,
  });
  return 0;
}

function testLocal(parsed: ParsedArgs, runtime: Runtime): number {
  const apiKey = resolveInstallApiKey(parsed, runtime);
  const result = spawnSync('npx', ['-y', CAMBRIAN_MCP_PACKAGE, '--version'], {
    encoding: 'utf8',
    env: { ...process.env, CAMBRIAN_API_KEY: apiKey },
  });
  if (result.status !== 0) {
    throw new Error(
      `Local MCP test failed. Ensure ${CAMBRIAN_MCP_PACKAGE} is published or installed. ${result.stderr.trim()}`,
    );
  }
  printJson(runtime, {
    ok: true,
    mode: 'local',
    package: CAMBRIAN_MCP_PACKAGE,
    version: result.stdout.trim(),
  });
  return 0;
}

function installClaude(parsed: ParsedArgs, runtime: Runtime, mode: McpMode): number {
  const dryRun = hasOption(parsed, 'dry-run');
  const apiKey = dryRun ? undefined : resolveInstallApiKey(parsed, runtime);
  const serverConfig = buildServerConfig(mode, parsed, {
    includeSecret: !dryRun,
    apiKey,
  });
  const configJson = JSON.stringify(serverConfig);
  const command = ['claude', 'mcp', 'add-json', CAMBRIAN_MCP_SERVER_NAME, configJson];

  if (dryRun) {
    printJson(runtime, {
      ok: true,
      dryRun: true,
      command,
      config: serverConfig,
    });
    return 0;
  }

  const result = spawnSync(command[0], command.slice(1), {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`claude mcp add-json failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  printJson(runtime, {
    ok: true,
    client: 'claude',
    mode,
    server: CAMBRIAN_MCP_SERVER_NAME,
  });
  return 0;
}

export function mcpHelp(): string {
  return [
    'Usage:',
    '  cambrian mcp config [--client <claude|cursor|codex>] [--mode <hosted|local>] [--url <url>]',
    '  cambrian mcp install --client claude [--mode <hosted|local>] [--api-key <key>] [--dry-run]',
    '  cambrian mcp test [--mode <hosted|local>] [--api-key <key>] [--url <url>]',
    '',
    'Defaults:',
    `  --client claude`,
    `  --mode hosted`,
    `  hosted URL: ${CAMBRIAN_HOSTED_MCP_URL}`,
    `  local package: npx -y ${CAMBRIAN_MCP_PACKAGE}`,
    '',
    'Authentication:',
    '  Hosted and local MCP usage are BYOK. Use CAMBRIAN_API_KEY or --api-key.',
  ].join('\n');
}

export async function handleMcp(parsed: ParsedArgs, runtime: Runtime): Promise<number> {
  const subcommand = parsed.positionals[1];
  if (!subcommand || hasOption(parsed, 'help')) {
    runtime.stdout(mcpHelp());
    return 0;
  }

  assertNoUnknownOptions(
    parsed,
    ['help', 'client', 'mode', 'url', 'api-key', 'dry-run'],
    `mcp ${subcommand}`,
  );

  const client = resolveClient(parsed);
  const mode = resolveMode(parsed);

  switch (subcommand) {
    case 'config':
      printJson(runtime, buildClientConfig(client, mode, parsed));
      return 0;
    case 'install':
      if (client !== 'claude') {
        throw new CliUsageError('mcp install currently supports --client claude. Use mcp config for cursor/codex.');
      }
      return installClaude(parsed, runtime, mode);
    case 'test':
      return mode === 'hosted' ? await testHosted(parsed, runtime) : testLocal(parsed, runtime);
    default:
      throw new CliUsageError(`Unknown mcp subcommand: ${subcommand}`);
  }
}
