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
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Runtime } from './core.js';

export interface CambrianConfig {
  /** Persisted API key (lowest-precedence source; see resolveApiKey). */
  apiKey?: string;
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

/** Reads the config, returning {} on any missing/invalid file (never throws). */
export function readConfig(runtime: Runtime): CambrianConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(runtime), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as CambrianConfig) : {};
  } catch {
    return {};
  }
}

/** Writes the config, creating the dir (0o700) and file (0o600) as needed. */
export function writeConfig(runtime: Runtime, config: CambrianConfig): void {
  mkdirSync(configDir(runtime), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(runtime), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}
