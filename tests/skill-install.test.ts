/**
 * Tests for `skill install` target selection.
 *
 * The important guarantee here is that an explicit `--path` is treated as an
 * explicit target selection, exactly like `--tool`: it must not silently pull
 * in auto-detected tool directories alongside it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { installSkill } from '../src/cli/skill.js';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cambrian-skill-'));
  created.push(dir);
  return dir;
}

/** A home directory that looks like Claude and OpenCode are both installed. */
function homeWithBothToolsInstalled(): string {
  const home = tempDir();
  mkdirSync(join(home, '.claude', 'skills', 'cambrian'), { recursive: true });
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  writeFileSync(join(home, '.claude', 'skills', 'cambrian', 'LOCAL.md'), 'user edit');
  return home;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('installSkill target selection', () => {
  it('does not auto-detect tool targets when an explicit path is given', () => {
    const home = homeWithBothToolsInstalled();
    const target = join(tempDir(), 'cambrian');

    const result = installSkill({ paths: [target], homedir: () => home });

    expect(result.installs).toEqual([{ tool: 'custom', path: target }]);
    expect(result.installs.map((i) => i.tool)).not.toContain('claude');
    expect(result.installs.map((i) => i.tool)).not.toContain('opencode');
  });

  it('leaves unrelated tool directories untouched when an explicit path is given', () => {
    const home = homeWithBothToolsInstalled();
    const claudeSkill = join(home, '.claude', 'skills', 'cambrian');
    const target = join(tempDir(), 'cambrian');

    installSkill({ paths: [target], homedir: () => home });

    expect(readFileSync(join(claudeSkill, 'LOCAL.md'), 'utf8')).toBe('user edit');
    expect(existsSync(join(claudeSkill, 'SKILL.md'))).toBe(false);
  });

  it('installs to the explicit path', () => {
    const home = homeWithBothToolsInstalled();
    const target = join(tempDir(), 'cambrian');

    installSkill({ paths: [target], homedir: () => home });

    expect(existsSync(join(target, 'SKILL.md'))).toBe(true);
  });

  it('installs only the requested tool when --tool is given', () => {
    const home = homeWithBothToolsInstalled();

    const result = installSkill({ tools: ['opencode'], homedir: () => home });

    expect(result.installs.map((i) => i.tool)).toEqual(['opencode']);
  });

  it('still auto-detects when neither tools nor paths are given', () => {
    const home = homeWithBothToolsInstalled();

    const result = installSkill({ homedir: () => home });

    expect(result.installs.map((i) => i.tool).sort()).toEqual(['claude', 'opencode']);
  });

  it('throws when nothing is selected and nothing is detected', () => {
    const home = tempDir();

    expect(() => installSkill({ homedir: () => home })).toThrow(/No known tool directories/);
  });
});
