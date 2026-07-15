#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { resolve, relative, join, basename } from 'path';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const dot = '.';
const hidden = (name) => `${dot}${name}`;
const text = (...parts) => parts.join('');
const relPath = (...parts) => parts.join('/');

const forbiddenPaths = [
  hidden('claude'),
  hidden('agents'),
  hidden('codex'),
  hidden(text('ricky', 'data_code')),
  text('AGENTS', '.md'),
  hidden('env'),
  relPath('docs', text('cli-', 'improvements.md')),
  relPath('skills', 'cambrian', 'references', text('deep42-docs-', 'drift.md')),
];

const forbiddenTerms = [
  text('cambrian', '_cli'),
  text('ricky', 'cambrian'),
  text('ricky', 'data'),
  text('deep42-docs-', 'drift'),
  text('cli-', 'improvements'),
  text('Cloud', ' Run'),
  text('deep42', '-x402-', 'api-', 'prod'),
  text('cambrian-', 'protocol'),
];

const skipDirs = new Set(['.git', 'node_modules']);
const failures = [];

function normalize(path) {
  return path.split('\\').join('/');
}

function fail(message) {
  failures.push(message);
}

function isForbiddenPath(rel) {
  const normalized = normalize(rel);
  return forbiddenPaths.some((forbidden) => {
    const path = normalize(forbidden);
    return normalized === path || normalized.startsWith(`${path}/`);
  });
}

function isTextFile(path) {
  const bytes = readFileSync(path);
  return !bytes.subarray(0, 4096).includes(0);
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const abs = join(dir, entry);
    const rel = normalize(relative(repoRoot, abs));
    visit(abs, rel);
    if (statSync(abs).isDirectory()) {
      walk(abs, visit);
    }
  }
}

if (!existsSync(join(repoRoot, 'package.json'))) {
  fail(`No package.json found at ${repoRoot}`);
}

walk(repoRoot, (abs, rel) => {
  if (basename(abs) === '.DS_Store') {
    fail(`Forbidden Finder metadata file: ${rel}`);
    return;
  }
  if (isForbiddenPath(rel)) {
    fail(`Forbidden internal path: ${rel}`);
    return;
  }
  if (!statSync(abs).isFile() || !isTextFile(abs)) return;
  const body = readFileSync(abs, 'utf8');
  for (const term of forbiddenTerms) {
    if (body.includes(term)) {
      fail(`Forbidden internal marker "${term}" in ${rel}`);
    }
  }
});

const pkgPath = join(repoRoot, 'package.json');
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const publicRepo = 'git+https://github.com/cambriannetwork/cambrian-cli.git';
  const publicHome = 'https://github.com/cambriannetwork/cambrian-cli#readme';
  const publicBugs = 'https://github.com/cambriannetwork/cambrian-cli/issues';
  if (pkg.repository?.url !== publicRepo) fail(`package.json repository.url must be ${publicRepo}`);
  if (pkg.homepage !== publicHome) fail(`package.json homepage must be ${publicHome}`);
  if (pkg.bugs?.url !== publicBugs) fail(`package.json bugs.url must be ${publicBugs}`);
  if (pkg.scripts?.ci !== 'npm test && npm run build') {
    fail('package.json scripts.ci must be "npm test && npm run build"');
  }
  if (pkg.scripts?.['check:public'] !== 'node scripts/check-public-release.mjs') {
    fail('package.json scripts.check:public must run scripts/check-public-release.mjs');
  }
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    fail('package.json must not declare runtime dependencies');
  }
  if (!Array.isArray(pkg.files) || pkg.files.includes('skills/') || pkg.files.includes('skills')) {
    fail('package.json files must explicitly allowlist public skill files, not the whole skills directory');
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`public-release-check: ${failure}`);
  }
  process.exit(1);
}

console.log(`public-release-check: passed for ${repoRoot}`);
