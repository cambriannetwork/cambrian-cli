import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli/index.js';

const temporaryDirectories: string[] = [];

function fakeCommand(name: string, output: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'cambrian-mcp-bin-'));
  temporaryDirectories.push(directory);
  const executable = join(directory, name);
  writeFileSync(executable, `#!/bin/sh\nwhile IFS= read -r _; do :; done\nprintf '%s' '${output}'\n`);
  chmodSync(executable, 0o755);
  return directory;
}

function fakeMcpCommand(version: string): string {
  return fakeCommand('npx', [
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', serverInfo: { version } },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [{ name: 'cambrian_base_dexes' }] },
    }),
  ].join('\n'));
}

function recordingCommand(name: string, output: string, resultFile: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'cambrian-mcp-bin-'));
  temporaryDirectories.push(directory);
  const executable = join(directory, name);
  writeFileSync(executable, `#!/bin/sh\nprintf '%s' '${output}' > '${resultFile}'\n`);
  chmodSync(executable, 0o755);
  return directory;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('MCP child-process environment', () => {
  it.skipIf(process.platform === 'win32')('uses the injected runtime environment for local tests', async () => {
    const inheritedBin = fakeMcpCommand('inherited-environment');
    const runtimeBin = fakeMcpCommand('runtime-environment');
    vi.stubEnv('PATH', inheritedBin);

    let stdout = '';
    const code = await runCli(['mcp', 'test', '--mode', 'local'], {
      stdout: (line) => { stdout += `${line}\n`; },
      stderr: () => {},
      env: {
        CAMBRIAN_API_KEY: 'test-key',
        CAMBRIAN_SCHEMA_MODE: 'bundled',
        PATH: runtimeBin,
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ version: 'runtime-environment' });
  });

  it.skipIf(process.platform === 'win32')('uses the injected runtime environment for Claude installation', async () => {
    const resultDirectory = mkdtempSync(join(tmpdir(), 'cambrian-mcp-result-'));
    temporaryDirectories.push(resultDirectory);
    const resultFile = join(resultDirectory, 'environment.txt');
    const inheritedBin = recordingCommand('claude', 'inherited-environment', resultFile);
    const runtimeBin = recordingCommand('claude', 'runtime-environment', resultFile);
    vi.stubEnv('PATH', inheritedBin);

    const code = await runCli(
      ['mcp', 'install', '--client', 'claude', '--api-key', 'test-key'],
      {
        stdout: () => {},
        stderr: () => {},
        env: {
          CAMBRIAN_SCHEMA_MODE: 'bundled',
          PATH: runtimeBin,
        },
      },
    );

    expect(code).toBe(0);
    expect(readFileSync(resultFile, 'utf8')).toBe('runtime-environment');
  });
});
