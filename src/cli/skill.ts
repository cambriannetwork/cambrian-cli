import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { homedir as defaultHomedir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { resolvePackageRoot } from './core.js';

const SKILL_BUNDLE_NAME = 'cambrian';
export const INSTALLABLE_SKILL_TOOLS = ['claude', 'opencode'] as const;
export const SKILL_ADAPTERS = ['claude', 'openai', 'opencode'] as const;

function getSkillAdapterPath(adapter: string): string {
  switch (adapter) {
    case 'claude':
      return join(getSkillSourceDir(), 'agents', 'claude.md');
    case 'openai':
      return join(getSkillSourceDir(), 'agents', 'openai.yaml');
    case 'opencode':
      return join(getSkillSourceDir(), 'agents', 'opencode.md');
    default:
      throw new Error(`Unknown adapter: ${adapter}`);
  }
}

function getSkillSourceDir(): string {
  return join(resolvePackageRoot(import.meta.url), 'skills', SKILL_BUNDLE_NAME);
}

function getKnownTargets(home: string): Record<string, string> {
  return {
    claude: join(home, '.claude', 'skills', SKILL_BUNDLE_NAME),
    opencode: join(home, '.config', 'opencode', 'skills', SKILL_BUNDLE_NAME),
  };
}

function getParentPathsByTool(home: string): Record<string, string[]> {
  return {
    claude: [join(home, '.claude')],
    opencode: [join(home, '.config', 'opencode'), join(home, '.opencode')],
  };
}

function detectInstalledToolTargets(home: string): string[] {
  const targets = getKnownTargets(home);
  const parentPathsByTool = getParentPathsByTool(home);
  return Object.entries(targets)
    .filter(([tool]) => {
      return parentPathsByTool[tool].some((parentPath) => existsSync(parentPath)) || existsSync(targets[tool]);
    })
    .map(([tool]) => tool);
}

function copySkillDirectory(sourceDir: string, targetDir: string): void {
  const resolvedTargetDir = resolve(targetDir);
  if (basename(resolvedTargetDir) !== SKILL_BUNDLE_NAME) {
    throw new Error(`Skill install targets must end with "${SKILL_BUNDLE_NAME}".`);
  }
  if (resolvedTargetDir === dirname(resolvedTargetDir)) {
    throw new Error('Refusing to overwrite the filesystem root.');
  }
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(dirname(targetDir), { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
}

export function readSkillMarkdown(): string {
  return readFileSync(join(getSkillSourceDir(), 'SKILL.md'), 'utf8');
}

export function readSkillAdapter(adapter: string): string {
  return readFileSync(getSkillAdapterPath(adapter), 'utf8');
}

export function listSkillTargets(options?: { homedir?: () => string }) {
  const home = (options?.homedir ?? defaultHomedir)();
  const knownTargets = getKnownTargets(home);
  const parentPathsByTool = getParentPathsByTool(home);
  return Object.entries(knownTargets).map(([tool, path]) => ({
    tool,
    path,
    detected:
      parentPathsByTool[tool].some((parentPath) => existsSync(parentPath)) || existsSync(path),
    installed: existsSync(path),
  }));
}

export function installSkill(options: {
  tools?: string[];
  paths?: string[];
  homedir?: () => string;
} = {}) {
  const home = (options.homedir ?? defaultHomedir)();
  const sourceDir = getSkillSourceDir();
  const knownTargets = getKnownTargets(home);

  const explicitTools = options.tools ?? [];
  const explicitPaths = options.paths ?? [];
  const autoDetectedTools = explicitTools.length === 0 ? detectInstalledToolTargets(home) : [];
  const selectedTools = explicitTools.length > 0 ? explicitTools : autoDetectedTools;

  if (selectedTools.length === 0 && explicitPaths.length === 0) {
    throw new Error(
      'No known tool directories were detected. Re-run with --tool <name> or --path <dir>.',
    );
  }

  const installs: Array<{ tool: string; path: string }> = [];

  for (const tool of selectedTools) {
    const targetDir = knownTargets[tool];
    copySkillDirectory(sourceDir, targetDir);
    installs.push({ tool, path: targetDir });
  }

  for (const targetDir of explicitPaths) {
    copySkillDirectory(sourceDir, targetDir);
    installs.push({ tool: 'custom', path: targetDir });
  }

  return { sourceDir, installs };
}
