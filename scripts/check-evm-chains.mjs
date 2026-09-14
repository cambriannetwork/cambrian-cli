#!/usr/bin/env node

/**
 * Deterministic EVM chain-support drift check.
 *
 * Reads the live Cambrian EVM OpenAPI document, extracts every endpoint's
 * chain_id allow-list, and compares it to the CLI's chain registry
 * (src/cli/evm-chains.ts). This is the single command an agent (or CI) runs to
 * answer "which chains does the API serve, and does the CLI expose them all?".
 *
 * Exit codes:
 *   0  registry covers every chain the OpenAPI serves
 *   1  a chain is served by the API but missing from the registry (needs a row)
 *   1  --strict and a registry chain is absent from the document
 *
 * Usage:
 *   node scripts/check-evm-chains.mjs
 *   node scripts/check-evm-chains.mjs --strict
 *   node scripts/check-evm-chains.mjs --json
 *   node scripts/check-evm-chains.mjs --file /tmp/evm-openapi.json
 *   node scripts/check-evm-chains.mjs --url https://api.cambrian.org/evm/openapi.json
 */

import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_URL = 'https://api.cambrian.org/evm/openapi.json';

function parseArgs(argv) {
  const options = { url: DEFAULT_URL, file: undefined, json: false, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--file') options.file = argv[++index];
    else if (arg === '--url') options.url = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  return options;
}

async function loadAuditor() {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'cambrian-chain-audit-'));
  const outfile = join(temporaryDirectory, 'audit.mjs');
  await build({
    entryPoints: [resolve(ROOT, 'src', 'cli', 'evm-chain-audit.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
  });
  try {
    return await import(pathToFileURL(outfile).href + '?v=' + Date.now());
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function loadDocument(options) {
  if (options.file) {
    const document = JSON.parse(readFileSync(options.file, 'utf8'));
    return { document, source: options.file };
  }
  const response = await fetch(options.url, {
    headers: { accept: 'application/json', 'user-agent': 'cambrian-chain-audit' },
  });
  if (!response.ok) throw new Error('Failed to fetch ' + options.url + ': HTTP ' + response.status);
  const document = await response.json();
  return { document, source: options.url };
}

function printHelp() {
  console.log('Usage: node scripts/check-evm-chains.mjs [--url <url>] [--file <path>] [--json] [--strict]');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }

  const { auditEvmChains, auditNormalizedEvmChains, openApiChainSupport, normalizedChainSupport } =
    await loadAuditor();
  const { document, source } = await loadDocument(options);
  // Auto-detect format: raw OpenAPI has an `openapi` field; the normalized
  // registry snapshot is keyed by metadata group (`evm`, `solana`, ...).
  const isRawOpenApi =
    document && typeof document === 'object' && typeof document.openapi === 'string';
  const audit = isRawOpenApi ? auditEvmChains(document) : auditNormalizedEvmChains(document);
  const support = isRawOpenApi ? openApiChainSupport(document) : normalizedChainSupport(document);

  if (options.json) {
    console.log(JSON.stringify({ source, endpointCount: support.size, ...audit }, null, 2));
  } else {
    console.log('EVM chain audit against ' + source);
    console.log('  format: ' + (isRawOpenApi ? 'raw OpenAPI' : 'normalized registry'));
    console.log('  entries with an explicit chain_id: ' + support.size);
    console.log('  discovered chain ids: ' + audit.discoveredChainIds.join(', '));
    console.log('  registry chain ids:   ' + audit.registryChainIds.join(', '));
    for (const entry of audit.perChain) {
      console.log(
        '  ' + entry.chain.command.padEnd(10) +
        'chain_id=' + String(entry.chain.chainId).padEnd(7) +
        entry.endpoints + ' entries ' +
        (entry.samplePaths.length ? '(e.g. ' + entry.samplePaths[0] + ')' : ''),
      );
    }
    if (audit.unregisteredChainIds.length > 0) {
      console.log('');
      console.log('NEW CHAIN(S) SERVED BY THE API: ' + audit.unregisteredChainIds.join(', '));
      console.log(
        'The CLI already exposes each as chain-<id> at runtime with no upgrade, ' +
        'so users are not blocked.',
      );
      console.log(
        'Add a curated row in src/cli/evm-chains.ts (see the add-evm-chain skill) ' +
        'to give it a friendly command name.',
      );
    }
    if (audit.unsupportedChains.length > 0) {
      console.log('');
      console.log(
        'Registry chains absent from this document: ' +
        audit.unsupportedChains.map((chain) => chain.command + ' (' + chain.chainId + ')').join(', '),
      );
    }
  }

  if (audit.unregisteredChainIds.length > 0) return 1;
  if (options.strict && audit.unsupportedChains.length > 0) return 1;
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
