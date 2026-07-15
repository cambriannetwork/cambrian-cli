/**
 * Tests for the typo-suggestion helpers and their wiring into CLI errors.
 */

import { describe, it, expect } from 'vitest';
import { levenshtein, suggestMatches, didYouMean } from '../src/cli/suggest.js';
import { runCli } from '../src/cli/index.js';

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('trendng', 'trending')).toBe(1);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('suggestMatches', () => {
  const candidates = ['trending-tokens', 'token-details', 'latest-block', 'price-current'];

  it('suggests a close typo, ranked by distance', () => {
    expect(suggestMatches('trendng-tokens', candidates)[0]).toBe('trending-tokens');
  });

  it('suggests by case-insensitive prefix', () => {
    expect(suggestMatches('price', candidates)).toContain('price-current');
    expect(suggestMatches('TRENDING', candidates)).toContain('trending-tokens');
  });

  it('returns nothing for a far-off input', () => {
    expect(suggestMatches('zzzzzzzzz', candidates)).toEqual([]);
  });
});

describe('didYouMean', () => {
  it('builds a suggestion clause', () => {
    expect(didYouMean('solan', ['solana', 'risk'])).toContain('Did you mean');
    expect(didYouMean('solan', ['solana', 'risk'])).toContain('"solana"');
  });

  it('is empty when nothing is close', () => {
    expect(didYouMean('qqqq', ['solana', 'risk'])).toBe('');
  });
});

describe('CLI typo suggestions', () => {
  function capture(argv: string[]): Promise<{ code: number; stderr: string }> {
    let stderr = '';
    return runCli(argv, {
      stdout: () => {},
      stderr: (msg: string) => { stderr += msg + '\n'; },
      env: { CAMBRIAN_SCHEMA_MODE: 'bundled' },
    }).then((code) => ({ code, stderr }));
  }

  it('suggests the nearest command for an unknown command', async () => {
    const { code, stderr } = await capture(['slana']);
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown command: slana');
    expect(stderr).toContain('"solana"');
  });

  it('suggests the nearest resource for an unknown resource (with a key)', async () => {
    const { code, stderr } = await capture(['solana', 'trendng-tokens', '--api-key', 'dummy']);
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown solana resource');
    expect(stderr).toContain('"trending-tokens"');
  });
});
