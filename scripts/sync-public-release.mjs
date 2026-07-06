#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dot = '.';
const hidden = (name) => `${dot}${name}`;
const text = (...parts) => parts.join('');
const relPath = (...parts) => parts.join('/');

function parseArgs(argv) {
  const out = {
    target: process.env.CAMBRIAN_PUBLIC_REPO
      ? resolve(process.env.CAMBRIAN_PUBLIC_REPO)
      : resolve(sourceRoot, '..', 'cambrian-cli'),
    allowDirty: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      const value = argv[index + 1];
      if (!value) throw new Error('--target requires a value');
      out.target = resolve(value);
      index += 1;
    } else if (arg === '--allow-dirty') {
      out.allowDirty = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return out;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout}${result.stderr}`.trim() : '';
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `\n${detail}` : ''}`);
  }
  return result.stdout ?? '';
}

function normalize(path) {
  return path.split('\\').join('/');
}

function removeFinderMetadata(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (entry === '.DS_Store') {
      rmSync(abs, { force: true });
      continue;
    }
    if (statSync(abs).isDirectory() && entry !== '.git' && entry !== 'node_modules') {
      removeFinderMetadata(abs);
    }
  }
}

function patchPublicPackage(target) {
  const pkgPath = join(target, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.repository = {
    type: 'git',
    url: 'git+https://github.com/cambriannetwork/cambrian-cli.git',
  };
  pkg.homepage = 'https://github.com/cambriannetwork/cambrian-cli#readme';
  pkg.bugs = { url: 'https://github.com/cambriannetwork/cambrian-cli/issues' };
  pkg.scripts = {
    ...pkg.scripts,
    ci: 'npm test && npm run build',
  };
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function normalizePublicChangelogLinks(target) {
  const changelogPath = join(target, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) return;
  const privateSlug = text('cambriannetwork/', 'cambrian', '_cli');
  const oldPublicSlug = text('cambrian-', 'protocol/cambrian-cli');
  const publicSlug = 'cambriannetwork/cambrian-cli';
  const body = readFileSync(changelogPath, 'utf8')
    .replaceAll(privateSlug, publicSlug)
    .replaceAll(oldPublicSlug, publicSlug);
  writeFileSync(changelogPath, body);
}

const options = parseArgs(process.argv.slice(2));
const targetRoot = options.target;

if (!existsSync(join(targetRoot, '.git'))) {
  throw new Error(`Target is not a git repository: ${targetRoot}`);
}
if (normalize(relative(sourceRoot, targetRoot)) === '') {
  throw new Error('Target must be different from source.');
}

const remote = run('git', ['remote', '-v'], { cwd: targetRoot, capture: true });
if (!remote.includes('github.com/cambriannetwork/cambrian-cli.git')) {
  throw new Error('Target remote must be github.com/cambriannetwork/cambrian-cli.git');
}

if (!options.allowDirty) {
  const status = run('git', ['status', '--porcelain'], { cwd: targetRoot, capture: true });
  if (status.trim().length > 0) {
    throw new Error('Target worktree is dirty. Commit/stash/clean it first, or pass --allow-dirty intentionally.');
  }
}

const excluded = [
  '.git/',
  '.github/',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'node_modules/',
  relPath('docs', 'release.md'),
  'dist/',
  hidden('env'),
  `${hidden('claude')}/`,
  `${hidden('agents')}/`,
  `${hidden('codex')}/`,
  `${hidden(text('ricky', 'data_code'))}/`,
  text('AGENTS', '.md'),
  '.DS_Store',
  '**/.DS_Store',
  relPath('docs', text('cli-', 'improvements.md')),
  relPath('skills', 'cambrian', 'references', text('deep42-docs-', 'drift.md')),
];

const forbiddenCleanupPaths = [
  hidden('env'),
  hidden('claude'),
  hidden('agents'),
  hidden('codex'),
  hidden(text('ricky', 'data_code')),
  text('AGENTS', '.md'),
  relPath('docs', text('cli-', 'improvements.md')),
  relPath('skills', 'cambrian', 'references', text('deep42-docs-', 'drift.md')),
];

const rsyncArgs = [
  '-a',
  '--delete',
  ...excluded.flatMap((entry) => ['--exclude', entry]),
  `${sourceRoot}/`,
  `${targetRoot}/`,
];
run('rsync', rsyncArgs);

for (const entry of forbiddenCleanupPaths) {
  rmSync(join(targetRoot, entry), { recursive: true, force: true });
}
removeFinderMetadata(targetRoot);
patchPublicPackage(targetRoot);
normalizePublicChangelogLinks(targetRoot);

run(process.execPath, [join(targetRoot, 'scripts/check-public-release.mjs'), targetRoot]);
console.log(`sync-public-release: staged ${sourceRoot} -> ${targetRoot}`);
