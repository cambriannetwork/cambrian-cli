/**
 * End-to-end test for the `cambrian docs` command path (handleDocs).
 *
 * Unit coverage for buildSchemaFallbackDocs / fetchDocs / --help schema hints
 * lives in tests/docs-fetcher.test.ts. This file only exercises the CLI
 * command wiring (runCli -> handleDocs) which that file does not cover:
 * llms.txt failure must still produce schema-derived docs at exit 0 (never throw).
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../src/cli/index.js';

// Fetch that always 404s (simulates llms.txt being unavailable).
const notFoundFetch = (async () =>
  new Response('not found', { status: 404 })) as unknown as typeof globalThis.fetch;

// Fetch that throws (simulates the network being down entirely).
const throwingFetch = (async () => {
  throw new Error('network down');
}) as unknown as typeof globalThis.fetch;

function runDocs(
  argv: string[],
  fetch: typeof globalThis.fetch,
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  return runCli(argv, {
    fetch,
    stdout: (line: string) => { stdout += line + '\n'; },
    stderr: (line: string) => { stderr += line + '\n'; },
    env: { CAMBRIAN_SCHEMA_MODE: 'bundled' },
  }).then((code) => ({ code, stdout, stderr }));
}

describe('cambrian docs command falls back gracefully (exit 0, no throw)', () => {
  it('prints schema fallback for an endpoint when llms.txt 404s', async () => {
    const { code, stdout } = await runDocs(['docs', 'base', 'aero-v2-pools'], notFoundFetch);
    expect(code).toBe(0);
    expect(stdout).toContain('GET /api/v1/evm/aero/v2/pools');
    expect(stdout).toContain('default: 100');
  });

  it('prints schema fallback for an endpoint when the network throws', async () => {
    const { code, stdout } = await runDocs(['docs', 'solana', 'latest-block'], throwingFetch);
    expect(code).toBe(0);
    expect(stdout).toContain('cambrian solana latest-block');
  });

  it('prints the network-error hint only when even the schema fallback is unavailable', async () => {
    // No group → no schema to fall back to.
    const { code, stderr } = await runDocs(['docs'], throwingFetch);
    expect(code).toBe(0);
    expect(stderr).toContain('Could not fetch documentation');
  });
});
