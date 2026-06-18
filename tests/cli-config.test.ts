/**
 * Integration tests (via runCli) for the Phase 3 commands: config set/get/clear,
 * the API-key precedence chain that now falls back to the stored config, the
 * completion command, and the hidden __complete endpoint.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runCli } from '../src/cli/index.js';
import type { Runtime } from '../src/cli/core.js';

const created: string[] = [];
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cambrian-cli-'));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(
  argv: string[],
  overrides: Partial<Runtime> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  return runCli(argv, {
    stdout: (line: string) => { stdout += line + '\n'; },
    stderr: (line: string) => { stderr += line + '\n'; },
    env: {},
    ...overrides,
  }).then((code) => ({ code, stdout, stderr }));
}

/** Captures the X-API-KEY header the client would send, via an injected fetch. */
function fetchEchoingApiKey(): { fetch: typeof globalThis.fetch; lastKey: () => string | null } {
  let key: string | null = null;
  const fetch = (async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    key = headers.get('x-api-key');
    return new Response(JSON.stringify({ columns: [], data: [], rows: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, lastKey: () => key };
}

describe('config command', () => {
  it('set-key persists, get-key reads it back, clear removes it', async () => {
    const home = tempHome();
    const homedir = () => home;

    const set = await run(['config', 'set-key', 'abc123'], { homedir });
    expect(set.code).toBe(0);
    expect(set.stdout).toContain('API key saved');

    const get = await run(['config', 'get-key'], { homedir });
    expect(get.code).toBe(0);
    expect(get.stdout.trim()).toBe('abc123');

    const clear = await run(['config', 'clear'], { homedir });
    expect(clear.code).toBe(0);

    const getAfter = await run(['config', 'get-key'], { homedir });
    expect(getAfter.code).toBe(1);
    expect(getAfter.stderr).toContain('No API key stored');
  });

  it('set-key without a key is a usage error (exit 2)', async () => {
    const { code, stderr } = await run(['config', 'set-key'], { homedir: () => tempHome() });
    expect(code).toBe(2);
    expect(stderr).toContain('Usage: cambrian config set-key');
  });
});

describe('API-key precedence', () => {
  it('falls back to the stored config key when no flag/env is set', async () => {
    const home = tempHome();
    const homedir = () => home;
    await run(['config', 'set-key', 'stored-key'], { homedir });

    const { fetch, lastKey } = fetchEchoingApiKey();
    const { code } = await run(['solana', 'tokens', '--base-url', 'http://x'], { homedir, fetch });
    expect(code).toBe(0);
    expect(lastKey()).toBe('stored-key');
  });

  it('env overrides the stored key; --api-key overrides env', async () => {
    const home = tempHome();
    const homedir = () => home;
    await run(['config', 'set-key', 'stored-key'], { homedir });

    const envRun = fetchEchoingApiKey();
    await run(['solana', 'tokens', '--base-url', 'http://x'], {
      homedir,
      fetch: envRun.fetch,
      env: { CAMBRIAN_API_KEY: 'env-key' },
    });
    expect(envRun.lastKey()).toBe('env-key');

    const flagRun = fetchEchoingApiKey();
    await run(['solana', 'tokens', '--base-url', 'http://x', '--api-key', 'flag-key'], {
      homedir,
      fetch: flagRun.fetch,
      env: { CAMBRIAN_API_KEY: 'env-key' },
    });
    expect(flagRun.lastKey()).toBe('flag-key');
  });
});

describe('completion', () => {
  it('prints a bash stub delegating to __complete', async () => {
    const { code, stdout } = await run(['completion', 'bash']);
    expect(code).toBe(0);
    expect(stdout).toContain('cambrian __complete');
  });

  it('rejects an unsupported shell (exit 2)', async () => {
    const { code, stderr } = await run(['completion', 'powershell']);
    expect(code).toBe(2);
    expect(stderr).toContain('completion <bash|zsh|fish>');
  });

  it('__complete prints candidates for the current words', async () => {
    const { code, stdout } = await run(['__complete', 'solana', 'trending']);
    expect(code).toBe(0);
    expect(stdout).toContain('trending-tokens');
  });

  it('__complete never errors on a partial flag token', async () => {
    const { code, stdout } = await run(['__complete', 'solana', 'tokens', '--li']);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('--limit');
  });
});
