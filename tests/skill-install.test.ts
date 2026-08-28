import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { installSkill } from '../src/cli/skill.js';

describe('installSkill', () => {
  it('uses the current Solana price-current flag in public guidance', () => {
    for (const path of [
      'README.md',
      'skills/cambrian/SKILL.md',
      'skills/cambrian/agents/opencode.md',
      'skills/cambrian/references/cli.md',
      'skills/cambrian/references/workflows.md',
    ]) {
      const contents = readFileSync(join(process.cwd(), path), 'utf8');
      expect(contents).not.toContain('solana price-current --token-address ');
      expect(contents).toContain('solana price-current --token-addresses ');
    }
  });

  it('installs only to an explicit path when tool directories are detected', () => {
    const root = mkdtempSync(join(tmpdir(), 'cambrian-skill-'));
    const home = join(root, 'home');
    const detectedSkill = join(home, '.claude', 'skills', 'cambrian');
    const target = join(root, 'custom', 'cambrian');
    mkdirSync(detectedSkill, { recursive: true });
    writeFileSync(join(detectedSkill, 'LOCAL.md'), 'user edit');

    try {
      const result = installSkill({ paths: [target], homedir: () => home });

      expect(result.installs).toEqual([{ tool: 'custom', path: target }]);
      expect(readFileSync(join(detectedSkill, 'LOCAL.md'), 'utf8')).toBe('user edit');
      expect(existsSync(join(target, 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
