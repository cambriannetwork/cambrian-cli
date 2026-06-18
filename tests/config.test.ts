/**
 * Unit tests for the persisted config store: directory resolution (XDG override
 * vs ~/.config default), read/write round-trip, file/dir permissions, and the
 * safe {} fallback for a missing file. Uses real temp dirs (no network).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRuntime } from '../src/cli/core.js';
import { configDir, configPath, readConfig, writeConfig } from '../src/cli/config.js';

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
});
