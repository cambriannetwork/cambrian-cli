/**
 * Unit tests for shell completion: candidate computation from bundled metadata,
 * the static stubs delegating to `__complete`, and shell validation.
 */

import { describe, it, expect } from 'vitest';
import {
  complete,
  completionScript,
  assertCompletionShell,
  COMPLETION_SHELLS,
} from '../src/cli/completion.js';
import { CliUsageError } from '../src/cli/core.js';

describe('complete', () => {
  it('completes top-level commands from a prefix', () => {
    expect(complete(['sol'])).toEqual(['solana']);
    const top = complete(['']);
    expect(top).toContain('solana');
    expect(top).toContain('config');
    expect(top).toContain('completion');
    expect(top).not.toContain('__complete'); // hidden
  });

  it('completes resources for a group (including the evm→base alias)', () => {
    const solana = complete(['solana', 'trending']);
    expect(solana).toContain('trending-tokens');
    const evm = complete(['evm', '']);
    const base = complete(['base', '']);
    expect(evm).toEqual(base); // evm is an alias for base
    expect(evm.length).toBeGreaterThan(0);
  });

  it('completes flags for a chosen resource, filtered by the partial token', () => {
    const all = complete(['solana', 'tokens', '--']);
    expect(all).toContain('--limit');
    expect(all).toContain('--offset');
    expect(all).toContain('--output'); // global flag
    expect(all).toContain('--all');
    const filtered = complete(['solana', 'tokens', '--li']);
    expect(filtered).toEqual(['--limit']);
  });

  it('returns nothing for an unknown group', () => {
    expect(complete(['nope', 'x'])).toEqual([]);
  });

  it('completes `pay <group> <resource> <flags>` one token deeper', () => {
    expect(complete([''])).toContain('pay'); // pay is a top-level command
    const groups = complete(['pay', '']);
    expect(groups).toEqual(expect.arrayContaining(['solana', 'base', 'evm', 'deep42', 'risk']));
    expect(complete(['pay', 'deep42', 'social'])).toContain('social-data/alpha-tweet-detection');
    const flags = complete(['pay', 'deep42', 'social-data/alpha-tweet-detection', '--']);
    expect(flags).toContain('--yes');
    expect(flags).toContain('--max-amount');
    expect(flags).toContain('--timeout');
    expect(flags).toContain('--limit'); // a resource param
  });
});

describe('completionScript', () => {
  it('emits a stub that delegates to `cambrian __complete` for each shell', () => {
    for (const shell of COMPLETION_SHELLS) {
      const script = completionScript(shell);
      expect(script).toContain('cambrian __complete');
      expect(script.length).toBeGreaterThan(0);
    }
  });
});

describe('assertCompletionShell', () => {
  it('accepts the supported shells (case-insensitive)', () => {
    expect(assertCompletionShell('BASH')).toBe('bash');
    expect(assertCompletionShell('fish')).toBe('fish');
  });
  it('throws a usage error otherwise', () => {
    expect(() => assertCompletionShell('powershell')).toThrowError(CliUsageError);
    expect(() => assertCompletionShell(undefined)).toThrowError(CliUsageError);
  });
});
