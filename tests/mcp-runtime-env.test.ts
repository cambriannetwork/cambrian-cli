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

  it('reports a missing claude executable instead of crashing', async () => {
    const emptyBin = mkdtempSync(join(tmpdir(), 'cambrian-mcp-bin-'));
    temporaryDirectories.push(emptyBin);

    let stderr = '';
    const code = await runCli(
      ['mcp', 'install', '--client', 'claude', '--api-key', 'test-key'],
      {
        stdout: () => {},
        stderr: (line) => { stderr += `${line}\n`; },
        env: {
          CAMBRIAN_SCHEMA_MODE: 'bundled',
          PATH: emptyBin,
        },
      },
    );

    expect(code).toBe(1);
    expect(stderr).toContain('could not run "claude"');
    expect(stderr).toContain('cambrian mcp config');
    expect(stderr).not.toContain('Cannot read properties');
  });

  it.runIf(process.platform === 'win32')('starts npx.cmd for local tests on Windows', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cambrian-mcp-bin-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'npx.cmd'), [
      '@echo off',
      'echo {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"version":"windows-npx"}}}',
      'echo {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"cambrian_base_dexes"}]}}',
    ].join('\r\n') + '\r\n');

    let stdout = '';
    let stderr = '';
    const code = await runCli(['mcp', 'test', '--mode', 'local'], {
      stdout: (line) => { stdout += `${line}\n`; },
      stderr: (line) => { stderr += `${line}\n`; },
      env: {
        CAMBRIAN_API_KEY: 'test-key',
        CAMBRIAN_SCHEMA_MODE: 'bundled',
        PATH: directory,
      },
    });

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ version: 'windows-npx' });
  });

  it.runIf(process.platform === 'win32')('starts claude.cmd for mcp install on Windows', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cambrian-mcp-bin-'));
    temporaryDirectories.push(directory);
    const resultFile = join(directory, 'called.txt').replace(/\\/g, '\\\\');
    // Only claude.cmd is on PATH — the same layout that used to fail with
    // spawnSync('claude') ENOENT after CVE-2024-27980. The JSON is delivered
    // via CAMBRIAN_MCP_ADD_JSON so cmd metacharacters in the key stay safe.
    writeFileSync(join(directory, 'claude.cmd'), [
      '@echo off',
      `if not defined CAMBRIAN_MCP_ADD_JSON exit /b 2`,
      `echo %1> "${resultFile}"`,
      `echo %2>> "${resultFile}"`,
      `echo %3>> "${resultFile}"`,
      `echo %CAMBRIAN_MCP_ADD_JSON%>> "${resultFile}"`,
      'exit /b 0',
    ].join('\r\n') + '\r\n');

    const apiKey = 'test&key%PATH%';
    let stdout = '';
    let stderr = '';
    const code = await runCli(
      ['mcp', 'install', '--client', 'claude', '--api-key', apiKey],
      {
        stdout: (line) => { stdout += `${line}\n`; },
        stderr: (line) => { stderr += `${line}\n`; },
        env: {
          CAMBRIAN_SCHEMA_MODE: 'bundled',
          PATH: directory,
          SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows',
          PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
        },
      },
    );

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, client: 'claude' });
    const recorded = readFileSync(join(directory, 'called.txt'), 'utf8');
    expect(recorded).toContain('mcp');
    expect(recorded).toContain('add-json');
    expect(recorded).toContain(apiKey);
  });
});
