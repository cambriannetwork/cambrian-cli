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
  it('resolves a newly indexed guide without a static CLI entry', async () => {
    const requests: string[] = [];
    const fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://docs.cambrian.org/llms.txt') {
        return new Response([
          '# Cambrian API Documentation',
          '## Available Guides',
          '- New Guide: https://docs.cambrian.org/guides/new-guide/llms.txt',
          '## Available Endpoints',
        ].join('\n'), { status: 200 });
      }
      if (url === 'https://docs.cambrian.org/guides/new-guide/llms.txt') {
        return new Response('# New guide\nAdded after this CLI release.', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof globalThis.fetch;

    const { code, stdout, stderr } = await runDocs(['docs', 'guides', 'new-guide'], fetch);

    expect(code).toBe(0);
    expect(stdout).toContain('# New guide');
    expect(stderr).toBe('');
    expect(requests).toEqual([
      'https://docs.cambrian.org/llms.txt',
      'https://docs.cambrian.org/guides/new-guide/llms.txt',
    ]);
  });

  it('rejects an unsafe guide name before fetching', async () => {
    let requests = 0;
    const fetch = (async () => {
      requests += 1;
      return new Response('must not fetch', { status: 200 });
    }) as typeof globalThis.fetch;

    const { code, stderr } = await runDocs(['docs', 'guides', '../x402'], fetch);

    expect(code).toBe(2);
    expect(stderr).toContain('Guide name must use lowercase letters, numbers, and hyphens');
    expect(requests).toBe(0);
  });

  it('lists only the available guides section from the root index', async () => {
    const root = [
      '# Cambrian API Documentation',
      '## API Key Required',
      'Get a key.',
      '## Available Guides',
      '- CLI: https://docs.cambrian.org/guides/cli/llms.txt',
      '- x402: https://docs.cambrian.org/guides/x402/llms.txt',
      '## Available Endpoints',
      '- GET /solana/latest-block',
    ].join('\n');

    const { code, stdout } = await runDocs(
      ['docs', 'guides'],
      (async () => new Response(root, { status: 200 })) as typeof globalThis.fetch,
    );

    expect(code).toBe(0);
    expect(stdout).toContain('## Available Guides');
    expect(stdout).toContain('/guides/x402/llms.txt');
    expect(stdout).not.toContain('## API Key Required');
    expect(stdout).not.toContain('## Available Endpoints');
  });

  it('shows the live guide list when a named guide is missing', async () => {
    const root = [
      '# Cambrian API Documentation',
      '## Available Guides',
      '- FAQs: https://docs.cambrian.org/guides/faqs/llms.txt',
      '## Available Endpoints',
      '- GET /solana/latest-block',
    ].join('\n');
    const fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith('/guides/not-found/llms.txt')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(root, { status: 200 });
    }) as typeof globalThis.fetch;

    const { code, stdout } = await runDocs(['docs', 'guides', 'not-found'], fetch);

    expect(code).toBe(0);
    expect(stdout).toContain('## Available Guides');
    expect(stdout).toContain('/guides/faqs/llms.txt');
    expect(stdout).not.toContain('## Available Endpoints');
  });

  it('prints schema fallback for an endpoint when llms.txt 404s', async () => {
    const { code, stdout } = await runDocs(['docs', 'base', 'aero-v2-pools'], notFoundFetch);
    expect(code).toBe(0);
    expect(stdout).toContain('GET /evm/aero/v2/pools');
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
