/**
 * "Update available" notice (Phase 3 #9). Mirrors yeoman/update-notifier:
 *   - the notice is read from a cached `latestVersion` (populated by a previous
 *     run's background check) and printed ONLY to stderr, so piped stdout/JSON
 *     stays clean;
 *   - the network check runs in a detached, unref'd child so it never blocks or
 *     delays process exit — its result is read on the *next* run;
 *   - it is suppressed under NO_UPDATE_NOTIFIER, CI, or a non-TTY stderr, and
 *     throttled to once per 24h.
 */

import { spawn } from 'child_process';
import type { Runtime } from './core.js';
import { readConfig, writeConfig, configPath } from './config.js';

const THROTTLE_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = 'https://registry.npmjs.org/cambrian/latest';

/** True when the update notice/check should be skipped entirely. */
export function isUpdateCheckSuppressed(opts: {
  env: Record<string, string | undefined>;
  stderrIsTTY: boolean;
}): boolean {
  if (opts.env.NO_UPDATE_NOTIFIER) return true;
  if (opts.env.CI) return true;
  if (!opts.stderrIsTTY) return true;
  return false;
}

/** Numeric dotted-version compare: true iff `a` is strictly greater than `b`. */
function isGreater(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/** Pure: the notice string when `latest` outranks `current`, else null. */
export function formatUpdateNotice(current: string, latest: string | undefined): string | null {
  if (!latest || !isGreater(latest, current)) return null;
  return (
    `\n  Update available: ${current} → ${latest}\n` +
    '  Run: npm install -g cambrian@latest\n'
  );
}

/** Marks the check time and spawns a detached refresh of the version cache. */
function spawnBackgroundCheck(runtime: Runtime, now: number): void {
  const cfg = readConfig(runtime);
  cfg.lastUpdateCheck = now; // throttle even if the fetch later fails
  writeConfig(runtime, cfg);

  try {
    const file = configPath(runtime);
    const script =
      `const {readFileSync,writeFileSync}=require('fs');` +
      `const f=${JSON.stringify(file)};` +
      `fetch(${JSON.stringify(REGISTRY_URL)}).then(r=>r.json()).then(j=>{` +
      `let c={};try{c=JSON.parse(readFileSync(f,'utf8'))}catch{}` +
      `if(j&&j.version){c.latestVersion=j.version;` +
      `writeFileSync(f,JSON.stringify(c,null,2)+'\\n',{mode:0o600})}` +
      `}).catch(()=>{});`;
    const child = spawn(process.execPath, ['-e', script], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    /* best-effort; never affect the foreground command */
  }
}

/**
 * Prints a cached update notice to stderr (when due and not suppressed) and
 * kicks off a throttled background refresh. Never writes stdout; never blocks.
 *
 * @param opts.stderrIsTTY  overrides the TTY probe (for tests).
 * @param opts.now          overrides the clock (for tests).
 * @param opts.spawn        set false to skip the background child (for tests).
 */
export function maybeNotifyUpdate(
  runtime: Runtime,
  currentVersion: string,
  opts: { stderrIsTTY?: boolean; now?: number; spawn?: boolean } = {},
): void {
  const stderrIsTTY = opts.stderrIsTTY ?? process.stderr?.isTTY === true;
  if (isUpdateCheckSuppressed({ env: runtime.env, stderrIsTTY })) return;

  const cfg = readConfig(runtime);
  const notice = formatUpdateNotice(currentVersion, cfg.latestVersion);
  if (notice) runtime.stderr(notice);

  const now = opts.now ?? Date.now();
  const due = !cfg.lastUpdateCheck || now - cfg.lastUpdateCheck > THROTTLE_MS;
  if (due && opts.spawn !== false) {
    spawnBackgroundCheck(runtime, now);
  }
}
