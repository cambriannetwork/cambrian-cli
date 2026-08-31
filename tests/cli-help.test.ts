/**
 * Tests that CLI help output is consistent with handler metadata.
 * Runs the actual CLI with --help and validates the output.
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../src/cli/index.js';
import { parseLocalMcpSmokeOutput } from '../src/cli/mcp.js';

function captureStdout(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  return runCli(argv, {
    stdout: (msg: string) => { stdout += msg + '\n'; },
    stderr: (msg: string) => { stderr += msg + '\n'; },
    env: { CAMBRIAN_SCHEMA_MODE: 'bundled' },
  }).then((code) => ({ code, stdout, stderr }));
}

describe('CLI help output', () => {
  it('cambrian --help advertises Base without the deprecated evm alias', async () => {
    const { stdout } = await captureStdout(['--help']);
    expect(stdout).toContain('cambrian base');
    expect(stdout).not.toContain('cambrian evm');
    expect(stdout).toContain('Advanced:');
    expect(stdout).toContain('cambrian schema');
  });

  it('documents that --timeout 0 disables the per-request timeout', async () => {
    const priceHelp = await captureStdout(['solana', 'price-current', '--help']);
    expect(priceHelp.stdout).toContain('--timeout <ms>');
    expect(priceHelp.stdout).toContain('0 disables it');

    const payHelp = await captureStdout(['pay', '--help']);
    expect(payHelp.stdout).toContain('--timeout <ms>');
    expect(payHelp.stdout).toContain('0 disables it');
  });

  it('documents safe config inspection and advanced schema controls precisely', async () => {
    const config = await captureStdout(['config', '--help']);
    expect(config.stdout).toContain('cambrian config status');
    expect(config.stdout).toContain('shell history');
    expect(config.stdout).toContain('compatibility command');

    const schema = await captureStdout(['schema', '--help']);
    expect(schema.stdout).toContain('never bypasses the floor');
    expect(schema.stdout).toContain('leaves the request cooldown intact');

    const completion = await captureStdout(['completion', '--help']);
    expect(completion.stdout).toContain('Run each append command only once');
  });

  it('cambrian --help points to console signup and the x402 alternative', async () => {
    const { stdout } = await captureStdout(['--help']);
    expect(stdout).toContain('Get an API key: https://console.cambrian.org/');
    expect(stdout).toContain('No API key? Use x402 pay-per-call: cambrian pay --help');
    expect(stdout).toContain('https://docs.cambrian.org/guides/x402/llms.txt');
    expect(stdout).toContain('cambrian docs guides');
    expect(stdout).not.toContain('form.typeform.com');
  });

  it('cambrian solana --help shows categorized resources', async () => {
    const { stdout } = await captureStdout(['solana', '--help']);
    expect(stdout).toContain('Pools - Orca');
    expect(stdout).toContain('OHLCV');
    expect(stdout).toContain('Transactions');
  });

  it('cambrian base --help shows categorized resources', async () => {
    const { stdout } = await captureStdout(['base', '--help']);
    expect(stdout).toContain('Aerodrome V2');
    expect(stdout).toContain('TVL');
    expect(stdout).not.toContain('cambrian evm');
  });

  it('keeps evm compatibility but warns users to select Base explicitly', async () => {
    const base = await captureStdout(['base', '--help']);
    const evm = await captureStdout(['evm', '--help']);
    expect(evm.code).toBe(0);
    expect(evm.stdout).toBe(base.stdout);
    expect(evm.stderr).toContain('"evm" is deprecated');
    expect(evm.stderr).toContain('Use "base" for Base chain 8453');

    for (const argv of [
      ['docs', 'evm', 'aero-v2-pools', '--offline'],
      ['schema', 'status', 'evm'],
    ]) {
      const result = await captureStdout(argv);
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('"evm" is deprecated');
    }
  });

  it('cambrian docs --help shows usage not docs content', async () => {
    const { stdout } = await captureStdout(['docs', '--help']);
    expect(stdout).toContain('Usage');
    expect(stdout).toContain('cambrian docs');
    expect(stdout).toContain('cambrian docs guides');
    expect(stdout).toContain('cambrian docs guides x402');
    expect(stdout).toContain('Guides require an internet connection');
    expect(stdout).not.toContain('# '); // should not contain markdown headers from actual docs
  });

  it('cambrian describe --help explains opencli', async () => {
    const { stdout } = await captureStdout(['describe', '--help']);
    expect(stdout).toContain('machine-readable');
    expect(stdout).toContain('OpenCLI');
  });

  it('OpenCLI discovery advertises the dynamic guides command', async () => {
    const { code, stdout } = await captureStdout(['describe', 'opencli', '--offline']);
    expect(code).toBe(0);
    const document = JSON.parse(stdout);
    const docs = document.commands.find((command: { name: string }) => command.name === 'docs');
    expect(docs).toBeDefined();
    expect(docs.commands).toContainEqual(expect.objectContaining({ name: 'guides' }));
    expect(JSON.stringify(docs)).not.toContain('x402');
    expect(document.commands.map((command: { name: string }) => command.name)).toEqual(
      expect.arrayContaining(['pay', 'config', 'completion']),
    );

    const solana = document.commands.find((command: { name: string }) => command.name === 'solana');
    expect(solana.options.map((option: { name: string }) => option.name)).toEqual(
      expect.arrayContaining([
        'api-key', 'json', 'output', 'fields', 'all', 'max-items',
        'timeout', 'retries', 'offline',
      ]),
    );

    const base = document.commands.find((command: { name: string }) => command.name === 'base');
    expect(base.aliases).toBeUndefined();

    const mcp = document.commands.find((command: { name: string }) => command.name === 'mcp');
    const mcpTest = mcp.commands.find((command: { name: string }) => command.name === 'test');
    expect(mcpTest.options.map((option: { name: string }) => option.name)).toEqual([
      'mode', 'url', 'api-key',
    ]);

    const config = document.commands.find((command: { name: string }) => command.name === 'config');
    expect(config.commands).toContainEqual(expect.objectContaining({ name: 'status' }));
    const schema = document.commands.find((command: { name: string }) => command.name === 'schema');
    expect(schema.commands.find((command: { name: string }) => command.name === 'clear-cache').description)
      .toContain('cooldown');
    expect(schema.commands.find((command: { name: string }) => command.name === 'status').options)
      .toContainEqual(expect.objectContaining({ name: 'offline' }));
    const pay = document.commands.find((command: { name: string }) => command.name === 'pay');
    expect(pay.options.map((option: { name: string }) => option.name)).toContain('offline');
    expect(pay.commands.find((command: { name: string }) => command.name === 'base').aliases)
      .toBeUndefined();
    expect(docs.commands.find((command: { name: string }) => command.name === 'base').aliases)
      .toBeUndefined();
    const describe = document.commands.find((command: { name: string }) => command.name === 'describe');
    expect(describe.commands.find((command: { name: string }) => command.name === 'opencli').options)
      .toContainEqual(expect.objectContaining({ name: 'offline' }));
  });

  it('per-resource --help marks required flags', async () => {
    const { stdout } = await captureStdout(['solana', 'ohlcv-token', '--help']);
    expect(stdout).toContain('--token-address (required)');
    expect(stdout).toContain('--interval (required)');
    expect(stdout).toContain('--after-time (required)');
    expect(stdout).toContain('--before-time (required)');
  });

  it('per-resource --help shows an example, global options, and a docs pointer', async () => {
    const { stdout } = await captureStdout(['solana', 'trending-tokens', '--help']);
    expect(stdout).toContain('Example:');
    expect(stdout).toContain('$ cambrian solana trending-tokens');
    expect(stdout).toContain('--retries');
    expect(stdout).toContain('Global options:');
    expect(stdout).toContain('--json            Emit structured JSON errors on stderr.');
    expect(stdout).toContain('cambrian docs solana trending-tokens');
  });

  it('per-resource --help example fills required flags with placeholders/enums', async () => {
    const { stdout } = await captureStdout(['solana', 'ohlcv-token', '--help']);
    expect(stdout).toContain('--token-address <token_address>');
  });

  it('per-resource --help for risk shows defaulted flags as optional', async () => {
    const { stdout } = await captureStdout(['risk', 'perp-risk-engine', '--help']);
    expect(stdout).toContain('--token-address');
    expect(stdout).not.toContain('--token-address (required)');
    expect(stdout).not.toContain('--entry-price (required)');
    expect(stdout).not.toContain('--leverage (required)');
    expect(stdout).not.toContain('--direction (required)');
    expect(stdout).not.toContain('--risk-horizon (required)');
  });

  it('cambrian mcp config prints hosted Claude config by default', async () => {
    const { code, stdout } = await captureStdout(['mcp', 'config']);
    expect(code).toBe(0);
    const config = JSON.parse(stdout);
    expect(config.mcpServers.cambrian.type).toBe('http');
    expect(config.mcpServers.cambrian.url).toBe('https://mcp.cambrian.org/mcp');
    expect(config.mcpServers.cambrian.headers.Authorization).toBe('Bearer ${CAMBRIAN_API_KEY}');
  });

  it('cambrian mcp config prints local npx config', async () => {
    const { code, stdout } = await captureStdout(['mcp', 'config', '--mode', 'local', '--client', 'cursor']);
    expect(code).toBe(0);
    const config = JSON.parse(stdout);
    expect(config.mcpServers.cambrian.command).toBe('npx');
    expect(config.mcpServers.cambrian.args).toEqual(['-y', 'cambrian-api-mcp']);
  });

  it('cambrian mcp config prints hosted Codex TOML', async () => {
    const { code, stdout } = await captureStdout(['mcp', 'config', '--client', 'codex']);
    expect(code).toBe(0);
    expect(stdout).toBe([
      '[mcp_servers.cambrian]',
      'url = "https://mcp.cambrian.org/mcp"',
      'bearer_token_env_var = "CAMBRIAN_API_KEY"',
      '',
    ].join('\n'));
  });

  it('cambrian mcp config prints local Codex TOML with environment forwarding', async () => {
    const { code, stdout } = await captureStdout(['mcp', 'config', '--client', 'codex', '--mode', 'local']);
    expect(code).toBe(0);
    expect(stdout).toBe([
      '[mcp_servers.cambrian]',
      'command = "npx"',
      'args = ["-y", "cambrian-api-mcp"]',
      'env_vars = ["CAMBRIAN_API_KEY"]',
      '',
    ].join('\n'));
  });

  it('rejects invalid hosted URLs and URLs that local mode would ignore', async () => {
    for (const argv of [
      ['mcp', 'config', '--url', 'file:///tmp/server'],
      ['mcp', 'config', '--mode', 'local', '--url', 'https://ignored.example'],
    ]) {
      let stderr = '';
      const code = await runCli(argv, {
        stdout: () => {},
        stderr: (msg: string) => { stderr += msg + '\n'; },
        env: { CAMBRIAN_SCHEMA_MODE: 'bundled' },
      });
      expect(code).toBe(2);
      expect(stderr).toContain('--url');
    }
  });

  it('cambrian mcp install supports dry-run without requiring secrets', async () => {
    const { code, stdout } = await captureStdout(['mcp', 'install', '--dry-run']);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.dryRun).toBe(true);
    expect(result.command.slice(0, 4)).toEqual(['claude', 'mcp', 'add-json', 'cambrian']);
  });

  it('cambrian mcp test reports missing auth clearly before network access', async () => {
    let stderr = '';
    const code = await runCli(['mcp', 'test'], {
      stdout: () => {},
      stderr: (msg: string) => { stderr += msg + '\n'; },
      env: { CAMBRIAN_SCHEMA_MODE: 'bundled' },
    });
    expect(code).toBe(2);
    expect(stderr).toContain('CAMBRIAN_API_KEY required');
  });

  it('cambrian mcp test checks a public tool at the canonical hosted endpoint', async () => {
    let requestedUrl = '';
    let stdout = '';
    const code = await runCli(['mcp', 'test'], {
      stdout: (msg: string) => { stdout += msg + '\n'; },
      stderr: () => {},
      fetch: (async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { tools: [{ name: 'cambrian_base_dexes' }] },
        }));
      }) as typeof globalThis.fetch,
      env: {
        CAMBRIAN_API_KEY: 'test-key',
        CAMBRIAN_SCHEMA_MODE: 'bundled',
      },
    });

    expect(code).toBe(0);
    expect(requestedUrl).toBe('https://mcp.cambrian.org/mcp');
    expect(JSON.parse(stdout)).toMatchObject({
      checkedTool: 'cambrian_base_dexes',
      url: 'https://mcp.cambrian.org/mcp',
    });
  });

  it('validates local MCP initialize and tools/list responses', () => {
    expect(parseLocalMcpSmokeOutput([
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'cambrian-api-mcp', version: '1.3.4' },
      } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, result: {
        tools: [{ name: 'cambrian_base_dexes' }, { name: 'cambrian_solana_latest_block' }],
      } }),
    ].join('\n'))).toEqual({
      version: '1.3.4',
      protocolVersion: '2025-06-18',
      toolCount: 2,
      checkedTool: 'cambrian_base_dexes',
    });
  });
});
