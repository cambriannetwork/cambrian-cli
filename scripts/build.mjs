import { build } from 'esbuild';
import { execSync } from 'child_process';
import { chmodSync, rmSync } from 'fs';

rmSync('dist', { recursive: true, force: true });

// CLI bundle: single ESM file with shebang
await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  // viem + the @x402 SDK are optional, lazily-imported peers for `cambrian pay`
  // (x402). Keep them out of the bundle so the core CLI stays zero runtime deps.
  external: ['viem', 'viem/*', '@x402/core', '@x402/core/*', '@x402/evm', '@x402/evm/*', '@x402/fetch'],
});
chmodSync('dist/cli.js', 0o755);

// Client library bundle
await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'dist/client/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: [],
});

// Shared metadata bundle for MCP/server consumers
await build({
  entryPoints: ['src/metadata.ts'],
  outfile: 'dist/metadata.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: [],
});

// Emit type declarations with paths that match package.json exports.
const tscBin = process.platform === 'win32' ? 'node_modules\\.bin\\tsc.cmd' : 'node_modules/.bin/tsc';
execSync(`${tscBin} --project tsconfig.json --emitDeclarationOnly --outDir dist`, {
  stdio: 'inherit',
});

console.log('Build complete.');
