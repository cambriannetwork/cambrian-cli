/**
 * Unit tests for the update notice: semver comparison, suppression conditions,
 * the stderr-only / never-stdout discipline, and the detached registry script
 * preserving secrets. The background spawn is disabled via { spawn: false }
 * except where the script is exercised directly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRuntime } from '../src/cli/core.js';
import { configPath, readConfig, writeConfig } from '../src/cli/config.js';
import {
  buildBackgroundUpdateCheckScript,
  formatUpdateNotice,
  isUpdateCheckSuppressed,
  maybeNotifyUpdate,
} from '../src/cli/update-check.js';

const created: string[] = [];
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cambrian-upd-'));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('formatUpdateNotice', () => {
  it('returns a notice when latest outranks current', () => {
    const n = formatUpdateNotice('0.1.14', '0.2.0');
    expect(n).toContain('0.1.14 → 0.2.0');
    expect(n).toContain('npm install -g cambrian@latest');
  });
  it('returns null when equal, older, or unknown', () => {
    expect(formatUpdateNotice('0.1.14', '0.1.14')).toBeNull();
    expect(formatUpdateNotice('1.2.0', '1.1.9')).toBeNull();
    expect(formatUpdateNotice('0.1.14', undefined)).toBeNull();
  });
});

describe('isUpdateCheckSuppressed', () => {
  it('suppresses under CI, NO_UPDATE_NOTIFIER, or a non-TTY stderr', () => {
    expect(isUpdateCheckSuppressed({ env: { CI: '1' }, stderrIsTTY: true })).toBe(true);
    expect(isUpdateCheckSuppressed({ env: { NO_UPDATE_NOTIFIER: '1' }, stderrIsTTY: true })).toBe(true);
    expect(isUpdateCheckSuppressed({ env: {}, stderrIsTTY: false })).toBe(true);
  });
  it('allows the check on an interactive non-CI terminal', () => {
    expect(isUpdateCheckSuppressed({ env: {}, stderrIsTTY: true })).toBe(false);
  });
});

describe('maybeNotifyUpdate', () => {
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    const home = tempHome();
    const runtime = createRuntime({
      homedir: () => home,
      env: {},
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    return { runtime, out, err };
  }

  it('writes the notice to stderr (never stdout) when a newer version is cached', () => {
    const { runtime, out, err } = capture();
    writeConfig(runtime, { latestVersion: '9.9.9', lastUpdateCheck: Date.now() });
    maybeNotifyUpdate(runtime, '0.1.0', { stderrIsTTY: true, spawn: false });
    expect(err.join('\n')).toContain('0.1.0 → 9.9.9');
    expect(out).toEqual([]); // stdout stays clean
  });

  it('is a no-op when suppressed (CI), even with a newer version cached', () => {
    const out: string[] = [];
    const err: string[] = [];
    const home = tempHome();
    const runtime = createRuntime({
      homedir: () => home,
      env: { CI: '1' },
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    writeConfig(runtime, { latestVersion: '9.9.9' });
    maybeNotifyUpdate(runtime, '0.1.0', { stderrIsTTY: true, spawn: false });
    expect(err).toEqual([]);
    expect(out).toEqual([]);
  });

  it('prints nothing when the cached version is not newer', () => {
    const { runtime, out, err } = capture();
    writeConfig(runtime, { latestVersion: '0.1.0', lastUpdateCheck: Date.now() });
    maybeNotifyUpdate(runtime, '0.1.0', { stderrIsTTY: true, spawn: false });
    expect(err).toEqual([]);
    expect(out).toEqual([]);
  });
});

describe('buildBackgroundUpdateCheckScript', () => {
  it('merges latestVersion without dropping apiKey or pending payments', () => {
    const home = tempHome();
    const runtime = createRuntime({ homedir: () => home, env: {} });
    writeConfig(runtime, {
      apiKey: 'keep-me',
      x402PendingPayments: {
        fp: {
          idempotencyKey: 'k',
          createdAt: 1,
          expiresAt: 99,
          amount: '1',
          network: 'base',
          payTo: '0x1',
        },
      },
    });
    const file = configPath(runtime);
    const script = buildBackgroundUpdateCheckScript(
      file,
      'data:application/json,{"version":"8.8.8"}',
    );
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      stdio: 'pipe',
      timeout: 10_000,
    });
    expect(readConfig(runtime)).toEqual({
      apiKey: 'keep-me',
      latestVersion: '8.8.8',
      x402PendingPayments: {
        fp: {
          idempotencyKey: 'k',
          createdAt: 1,
          expiresAt: 99,
          amount: '1',
          network: 'base',
          payTo: '0x1',
        },
      },
    });
  });

  it('leaves a corrupt config file unchanged', () => {
    const home = tempHome();
    const runtime = createRuntime({ homedir: () => home, env: {} });
    writeConfig(runtime, { apiKey: 'k' });
    const file = configPath(runtime);
    writeFileSync(file, '{broken', { mode: 0o600 });
    const script = buildBackgroundUpdateCheckScript(
      file,
      'data:application/json,{"version":"8.8.8"}',
    );
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      stdio: 'pipe',
      timeout: 10_000,
    });
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });
});
