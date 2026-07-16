/**
 * Tests for docs-fetcher: schema fallback on llms.txt failure and richer
 * --help lines (default/min/max from bundled schema).
 *
 * All fetch mocks are injected — no live network calls are made.
 */

import { describe, it, expect } from 'vitest';
import { fetchDocs, buildSchemaFallbackDocs } from '../src/cli/docs-fetcher.js';
import { runCli } from '../src/cli/index.js';

// ── Fetch helpers ────────────────────────────────────────────────────

function fetchFailing(): typeof globalThis.fetch {
  return (() => Promise.reject(new Error('network error'))) as unknown as typeof globalThis.fetch;
}

function fetchReturning(status: number, body = ''): typeof globalThis.fetch {
  return (() =>
    Promise.resolve(new Response(body, { status }))) as unknown as typeof globalThis.fetch;
}

// ── buildSchemaFallbackDocs unit tests ───────────────────────────────

describe('buildSchemaFallbackDocs', () => {
  it('returns null for an unknown group', () => {
    expect(buildSchemaFallbackDocs('unknown-group', 'something')).toBeNull();
  });

  it('returns null with no arguments', () => {
    expect(buildSchemaFallbackDocs()).toBeNull();
  });

  it('returns null when group is known but resource does not exist in schema', () => {
    expect(buildSchemaFallbackDocs('solana', 'nonexistent-resource-xyz')).toBeNull();
  });

  it('returns endpoint schema text for a known solana resource', () => {
    const result = buildSchemaFallbackDocs('solana', 'price-current');
    expect(result).not.toBeNull();
    expect(result).toContain('# cambrian solana price-current');
    expect(result).toContain('active OpenAPI schema');
    expect(result).toContain('--token-address');
  });

  it('resource text includes required annotation', () => {
    const result = buildSchemaFallbackDocs('solana', 'price-current');
    expect(result).toContain('required');
  });

  it('returns group resource list when no resource is given', () => {
    const result = buildSchemaFallbackDocs('solana');
    expect(result).not.toBeNull();
    expect(result).toContain('# cambrian solana');
    expect(result).toContain('active schema resource list');
    expect(result).toContain('price-current');
  });

  it('returns endpoint schema for evm (aliased to base in metadata)', () => {
    const result = buildSchemaFallbackDocs('evm', 'aero-v2-pools');
    expect(result).not.toBeNull();
    expect(result).toContain('# cambrian evm aero-v2-pools');
    expect(result).toContain('--limit');
  });

  it('evm endpoint includes default and range info', () => {
    const result = buildSchemaFallbackDocs('evm', 'aero-v2-pools');
    // limit has default: 100, range 1-1000
    expect(result).toContain('default: 100');
    expect(result).toContain('range 1-1000');
  });

  it('documents a validated CLI compatibility default in the executable contract', () => {
    const result = buildSchemaFallbackDocs('evm', 'aero-v2-pool');
    expect(result).toContain(
      '--apr-days-annualized  (integer, optional, CLI compatibility default: 30, range 1-30)',
    );
  });

  it('resolves deep42 aliases', () => {
    const result = buildSchemaFallbackDocs('deep42', 'alpha-tweets');
    // alpha-tweets resolves to social-data/alpha-tweet-detection
    expect(result).not.toBeNull();
    expect(result).toContain('# cambrian deep42 alpha-tweets');
  });

  it('returns risk schema for the perp-risk-engine resource', () => {
    const result = buildSchemaFallbackDocs('risk', 'perp-risk-engine');
    expect(result).not.toBeNull();
    expect(result).toContain('perp-risk-engine');
  });

  it('never throws for any input', () => {
    // Should not throw even with garbage input.
    expect(() => buildSchemaFallbackDocs(undefined, undefined)).not.toThrow();
    expect(() => buildSchemaFallbackDocs('', '')).not.toThrow();
    expect(() => buildSchemaFallbackDocs('solana', '')).not.toThrow();
  });
});

// ── fetchDocs fallback integration tests ────────────────────────────

describe('fetchDocs — schema fallback on llms.txt failure', () => {
  it('returns schema text (not null) when fetch rejects for an endpoint', async () => {
    const result = await fetchDocs(fetchFailing(), 'solana', 'price-current');
    expect(result).not.toBeNull();
    expect(result).toContain('active OpenAPI schema');
    expect(result).toContain('--token-address');
  });

  it('returns schema text when endpoint fetch returns 404', async () => {
    const result = await fetchDocs(fetchReturning(404), 'solana', 'price-current');
    expect(result).not.toBeNull();
    expect(result).toContain('active OpenAPI schema');
  });

  it('returns schema text when endpoint fetch returns 500', async () => {
    const result = await fetchDocs(fetchReturning(500), 'evm', 'aero-v2-pools');
    expect(result).not.toBeNull();
    expect(result).toContain('active OpenAPI schema');
    expect(result).toContain('--limit');
  });

  it('returns schema group list when group fetch fails and no resource given', async () => {
    const result = await fetchDocs(fetchFailing(), 'solana');
    expect(result).not.toBeNull();
    expect(result).toContain('active schema resource list');
    expect(result).toContain('price-current');
  });

  it('returns null (no fallback) when no group and no resource and fetch fails', async () => {
    const result = await fetchDocs(fetchFailing());
    expect(result).toBeNull();
  });

  it('returns live text when endpoint fetch succeeds', async () => {
    const liveText = 'LIVE ENDPOINT DOCS CONTENT';
    const fetch = fetchReturning(200, liveText);
    const result = await fetchDocs(fetch, 'solana', 'price-current');
    expect(result).toContain('Authoritative executable contract');
    expect(result).toContain('--token-address');
    expect(result).toContain(liveText);
  });

  it('replaces stale llms.txt parameter tables with the active OpenAPI contract', async () => {
    const liveText = [
      '# Aerodrome pools',
      '',
      '## Query Parameters',
      '',
      '| Parameter | Description |',
      '| --- | --- |',
      '| limit | Accepted range 1 to 90. |',
      '',
      '## Response Fields',
      '',
      'Pool response semantics remain useful.',
    ].join('\n');
    const result = await fetchDocs(
      fetchReturning(200, liveText),
      'base',
      'aero-v2-pools',
    );

    expect(result).toContain('Authoritative executable contract');
    expect(result).toContain('--limit  (integer, optional, default: 100, range 1-1000)');
    expect(result).not.toContain('Accepted range 1 to 90');
    expect(result).toContain('Pool response semantics remain useful.');
  });

  it('does not throw even when fetch throws unexpected errors', async () => {
    const weirdFetch = (() => {
      throw new RangeError('unexpected!');
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchDocs(weirdFetch, 'solana', 'price-current')).resolves.not.toThrow();
  });
});

// ── CLI --help lines include default/min/max from schema ─────────────

describe('per-resource --help includes schema hints', () => {
  function captureStdout(argv: string[]): Promise<{ code: number; stdout: string }> {
    let stdout = '';
    return runCli(argv, {
      stdout: (msg: string) => { stdout += msg + '\n'; },
      stderr: () => {},
      env: { CAMBRIAN_SCHEMA_MODE: 'bundled' },
    }).then((code) => ({ code, stdout }));
  }

  it('evm aero-v2-pools --help shows default and range for --limit', async () => {
    const { stdout } = await captureStdout(['evm', 'aero-v2-pools', '--help']);
    // limit: default 100, range 1-1000
    expect(stdout).toContain('--limit');
    expect(stdout).toContain('default: 100');
    expect(stdout).toContain('1-1000');
  });

  it('evm aero-v2-pools --help shows default and range for --offset', async () => {
    const { stdout } = await captureStdout(['evm', 'aero-v2-pools', '--help']);
    expect(stdout).toContain('--offset');
    expect(stdout).toContain('default: 0');
    expect(stdout).toContain('0-100000');
  });

  it('evm aero-v2-pool --help shows range for --apr-days-annualized', async () => {
    const { stdout } = await captureStdout(['evm', 'aero-v2-pool', '--help']);
    expect(stdout).toContain('--apr-days-annualized');
    expect(stdout).toContain('(CLI default: 30, 1-30)');
  });

  it('risk perp-risk-engine --help still shows required/optional markers', async () => {
    const { stdout } = await captureStdout(['risk', 'perp-risk-engine', '--help']);
    // Existing behavior: --token-address is optional (has default)
    expect(stdout).toContain('--token-address');
    expect(stdout).not.toContain('--token-address (required)');
  });
});
