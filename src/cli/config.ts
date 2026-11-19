/**
 * Persistent CLI config (Phase 3 #8/#9). Stores a small JSON document at the
 * platform config dir with restrictive permissions:
 *   - Windows:  %APPDATA%\cambrian\config.json
 *   - else:     $XDG_CONFIG_HOME/cambrian/config.json  (default ~/.config)
 *
 * The file is written `mode 0o600` inside a `0o700` directory. It holds the
 * optional persisted API key and the update-check cache. No native keychain
 * dependency — a 0600 file is the pragmatic, well-precedented choice for an API
 * key (a wallet private key would warrant more; that lives with x402, parked).
 *
 * Writes are atomic (temp file + rename) so a crash mid-write cannot leave a
 * truncated JSON document that later readers treat as an empty config.
 */

import { randomUUID } from 'crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { Runtime } from './core.js';

export interface CambrianConfig {
  /** Persisted API key (lowest-precedence source; see resolveApiKey). */
  apiKey?: string;
  /** Pending x402 attempts whose paid request may have settled but not returned. */
  x402PendingPayments?: Record<string, {
    idempotencyKey: string;
    createdAt: number;
    expiresAt: number;
    amount: string;
    network: string;
    payTo: string;
  }>;
  /** Epoch ms of the last update check (throttles the background refresh). */
  lastUpdateCheck?: number;
  /** Latest version seen on the registry, surfaced as a notice next run. */
  latestVersion?: string;
}

/** Resolves the platform config directory (does not create it). */
export function configDir(runtime: Runtime): string {
  const env = runtime.env;
  if (process.platform === 'win32' && env.APPDATA && env.APPDATA.length > 0) {
    return join(env.APPDATA, 'cambrian');
  }
  const base =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0
      ? env.XDG_CONFIG_HOME
      : join(runtime.homedir(), '.config');
  return join(base, 'cambrian');
}

/** Absolute path to the config JSON file. */
export function configPath(runtime: Runtime): string {
  return join(configDir(runtime), 'config.json');
}

/**
 * Reads the config, returning {} for a missing file or invalid JSON. Throws on
 * any other read error (e.g. EACCES on a root-owned file), so callers report
 * the real cause instead of "no stored key".
 */
export function readConfig(runtime: Runtime): CambrianConfig {
  const file = configPath(runtime);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot read config file ${file}: ${detail}\n` +
      'Fix its permissions (it may be owned by root after "sudo cambrian config set-key") or remove it.',
    );
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as CambrianConfig) : {};
  } catch {
    return {};
  }
}

/** Atomically replace `file` with `body` (temp + rename; cleans up on failure). */
function atomicWriteConfigFile(file: string, body: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, body, { mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Preserve the original write error if cleanup is also blocked.
    }
    throw error;
  }
}

/** Writes the config, creating the dir (0o700) and file (0o600) as needed. */
export function writeConfig(runtime: Runtime, config: CambrianConfig): void {
  mkdirSync(configDir(runtime), { recursive: true, mode: 0o700 });
  atomicWriteConfigFile(configPath(runtime), JSON.stringify(config, null, 2) + '\n');
}

/**
 * Merges `latestVersion` into an on-disk config without dropping other fields.
 * Used by the detached update-check child (and tests). Corrupt or non-object
 * JSON is left untouched — never replaced with `{ latestVersion }` alone.
 */
export function writeLatestVersionToConfigFile(
  file: string,
  version: string,
): 'written' | 'skipped' {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return 'skipped';
    atomicWriteConfigFile(file, JSON.stringify({ latestVersion: version }, null, 2) + '\n');
    return 'written';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'skipped';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'skipped';
  }

  const next: CambrianConfig = {
    ...(parsed as CambrianConfig),
    latestVersion: version,
  };
  atomicWriteConfigFile(file, JSON.stringify(next, null, 2) + '\n');
  return 'written';
}
