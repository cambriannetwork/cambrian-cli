/**
 * Tests that CLI help output is consistent with handler metadata.
 * Runs the actual CLI with --help and validates the output.
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../src/cli/index.js';

function captureStdout(argv: string[]): Promise<{ code: number; stdout: string }> {
  let stdout = '';
  return runCli(argv, {
    stdout: (msg: string) => { stdout += msg + '\n'; },
    stderr: () => {},
    env: { CAMBRIAN_SCHEMA_MODE: 'bundled' },
  }).then((code) => ({ code, stdout }));
}

describe('CLI help output', () => {
  it('cambrian --help shows base alias', async () => {
    const { stdout } = await captureStdout(['--help']);
    expect(stdout).toContain('cambrian base');
    expect(stdout).toContain('Aliases');
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
    expect(stdout).toContain('Aliases');
  });

  it('cambrian docs --help shows usage not docs content', async () => {
    const { stdout } = await captureStdout(['docs', '--help']);
    expect(stdout).toContain('Usage');
    expect(stdout).toContain('cambrian docs');
    expect(stdout).not.toContain('# '); // should not contain markdown headers from actual docs
  });

  it('cambrian describe --help explains opencli', async () => {
    const { stdout } = await captureStdout(['describe', '--help']);
    expect(stdout).toContain('machine-readable');
    expect(stdout).toContain('OpenCLI');
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
});
