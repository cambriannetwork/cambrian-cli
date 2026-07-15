import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const temporaryDirectories: string[] = [];
const checker = fileURLToPath(new URL('../scripts/check-public-release.mjs', import.meta.url));

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function publicPackage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'cambrian',
    repository: {
      url: 'git+https://github.com/cambriannetwork/cambrian-cli.git',
    },
    homepage: 'https://github.com/cambriannetwork/cambrian-cli#readme',
    bugs: {
      url: 'https://github.com/cambriannetwork/cambrian-cli/issues',
    },
    scripts: {
      ci: 'npm test && npm run build',
      'check:public': 'node scripts/check-public-release.mjs',
    },
    files: ['dist/'],
    ...overrides,
  };
}

function runCheck(pkg: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'cambrian-public-check-'));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  return spawnSync(process.execPath, [checker, directory], { encoding: 'utf8' });
}

describe('public release safety check', () => {
  it('accepts the zero-runtime-dependency public package contract', () => {
    const result = runCheck(publicPackage());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('public-release-check: passed');
  });

  it('rejects accidental runtime dependency promotion', () => {
    const result = runCheck(publicPackage({
      dependencies: {
        vite: '^6.4.3',
      },
    }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package.json must not declare runtime dependencies');
  });
});
