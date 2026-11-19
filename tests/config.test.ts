/**
 * Unit tests for the persisted config store: directory resolution (XDG override
 * vs ~/.config default), read/write round-trip, file/dir permissions, the
 * safe {} fallback for a missing file, atomic writes, and latestVersion merges
 * that must not wipe secrets. Uses real temp dirs (no network).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRuntime } from '../src/cli/core.js';
import {
  configDir,
  configPath,
  readConfig,
  writeConfig,
  writeLatestVersionToConfigFile,
} from '../src/cli/config.js';

const created: string[] = [];
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cambrian-cfg-'));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('configDir', () => {
  it('defaults to ~/.config/cambrian', () => {
    const home = tempHome();
    const rt = createRuntime({ homedir: () => home, env: {} });
    expect(configDir(rt)).toBe(join(home, '.config', 'cambrian'));
  });

  it('honors XDG_CONFIG_HOME', () => {
    const home = tempHome();
    const xdg = tempHome();
    const rt = createRuntime({ homedir: () => home, env: { XDG_CONFIG_HOME: xdg } });
    expect(configDir(rt)).toBe(join(xdg, 'cambrian'));
  });
});

describe('readConfig / writeConfig', () => {
  it('returns {} when no file exists', () => {
    const home = tempHome();
    const rt = createRuntime({ homedir: () => home, env: {} });
    expect(readConfig(rt)).toEqual({});
  });

  it('round-trips a config value', () => {
    const home = tempHome();
    const rt = createRuntime({ homedir: () => home, env: {} });
    writeConfig(rt, { apiKey: 'k', latestVersion: '9.9.9' });
    expect(readConfig(rt)).toEqual({ apiKey: 'k', latestVersion: '9.9.9' });
  });

  it('writes the file 0600 inside a 0700 dir', () => {
    const home = tempHome();
    const rt = createRuntime({ homedir: () => home, env: {} });
    writeConfig(rt, { apiKey: 'k' });
    // Mask to permission bits; skip on platforms without POSIX modes.
    const fileMode = statSync(configPath(rt)).mode & 0o777;
    const dirMode = statSync(configDir(rt)).mode & 0o777;
    if (process.platform !== 'win32') {
      expect(fileMode).toBe(0o600);
      expect(dirMode).toBe(0o700);
    }
  });

  it('returns {} for a corrupt file rather than throwing', () => {
    const home = tempHome();
    const rt = createRuntime({ homedir: () => home, env: {} });
    writeConfig(rt, { apiKey: 'k' }); // creates the dir
    writeFileSync(configPath(rt), '{not json', { mode: 0o600 });
    expect(readConfig(rt)).toEqual({});
  });

  it('leaves no temporary files after an atomic write', () => {
    const home = tempHome();
    const rt = createRuntime({ homedir: () => home, env: {} });
    writeConfig(rt, { apiKey: 'k' });
    const names = readdirSync(configDir(rt));
    expect(names).toEqual(['config.json']);
    expect(readConfig(rt)).toEqual({ apiKey: 'k' });
  });
});

describe('writeLatestVersionToConfigFile', () => {
  it('preserves apiKey and x402 pending state while updating latestVersion', () => {
    const home = tempHome();
    const rt = createRuntime({ homedir: () => home, env: {} });
    writeConfig(rt, {
      apiKey: 'secret-key',
      lastUpdateCheck: 1,
      x402PendingPayments: {
        abc: {
          idempotencyKey: 'idemp',
          createdAt: 1,
          expiresAt: 9,
          amount: '1000',
          network: 'base',
          payTo: '0xabc',
        },
      },
    });
    const file = configPath(rt);
    expect(writeLatestVersionToConfigFile(file, '9.9.9')).toBe('written');
    expect(readConfig(rt)).toEqual({
      apiKey: 'secret-key',
      lastUpdateCheck: 1,
      latestVersion: '9.9.9',
      x402PendingPayments: {
        abc: {
          idempotencyKey: 'idemp',
          createdAt: 1,
          expiresAt: 9,
          amount: '1000',
          network: 'base',
          payTo: '0xabc',
        },
      },
    });
  });

  it('does not wipe a corrupt config file', () => {
    const home = tempHome();
    const rt = createRuntime({ homedir: () => home, env: {} });
    writeConfig(rt, { apiKey: 'k' });
    const file = configPath(rt);
    writeFileSync(file, '{not json', { mode: 0o600 });
    expect(writeLatestVersionToConfigFile(file, '9.9.9')).toBe('skipped');
    expect(readConfig(rt)).toEqual({});
    // On-disk bytes stay corrupt rather than becoming { latestVersion } only.
    expect(statSync(file).size).toBe('{not json'.length);
  });

  it('creates a latestVersion-only file when the config is missing', () => {
    const home = tempHome();
    const rt = createRuntime({ homedir: () => home, env: {} });
    const file = configPath(rt);
    expect(writeLatestVersionToConfigFile(file, '1.2.3')).toBe('written');
    expect(readConfig(rt)).toEqual({ latestVersion: '1.2.3' });
  });
});
