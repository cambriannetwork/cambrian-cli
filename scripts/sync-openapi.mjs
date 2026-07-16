#!/usr/bin/env node

/**
 * Refreshes the bundled offline registry using the same OpenAPI interpreter and
 * llms.txt visibility policy as the runtime registry.
 *
 * Output: src/generated/openapi-params.json
 * Run: npm run sync-openapi
 */

import { build } from 'esbuild';
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT = resolve(ROOT, 'src', 'generated', 'openapi-params.json');
const LLMS_URL = 'https://docs.cambrian.org/llms.txt';
const OPENAPI_URLS = {
  opabinia: 'https://opabinia.cambrian.network/openapi.json',
  deep42: 'https://deep42.cambrian.network/openapi.json',
  risk: 'https://risk.cambrian.network/openapi.json',
};

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'cambrian-openapi-sync' },
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  const document = await response.json();
  if (
    !document ||
    typeof document !== 'object' ||
    typeof document.openapi !== 'string' ||
    !document.openapi.startsWith('3.') ||
    !document.info ||
    typeof document.info.title !== 'string' ||
    typeof document.info.version !== 'string' ||
    !document.paths ||
    typeof document.paths !== 'object' ||
    Array.isArray(document.paths)
  ) {
    throw new Error(`Invalid OpenAPI 3 document from ${url}`);
  }
  return document;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { accept: 'text/plain', 'user-agent': 'cambrian-openapi-sync' },
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

async function loadRuntimeInterpreter() {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'cambrian-openapi-sync-'));
  const outfile = join(temporaryDirectory, 'registry.mjs');
  await build({
    entryPoints: [resolve(ROOT, 'src', 'schema', 'registry.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
  });
  try {
    return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  console.log('Fetching authoritative OpenAPI and llms.txt documents ...');
  const [interpreter, opabinia, deep42, risk, llmsText] = await Promise.all([
    loadRuntimeInterpreter(),
    fetchJson(OPENAPI_URLS.opabinia),
    fetchJson(OPENAPI_URLS.deep42),
    fetchJson(OPENAPI_URLS.risk),
    fetchText(LLMS_URL),
  ]);
  const { normalizeOpenApiGroup, parseLlmsEndpointKeys, applyVisibilityPolicy } = interpreter;
  const llmsEndpointKeys = parseLlmsEndpointKeys(llmsText);
  const inputs = [
    ['solana', 'solana', opabinia],
    ['base', 'evm', opabinia],
    ['deep42', 'deep42', deep42],
    ['risk', 'risk', risk],
  ];
  const result = {};

  for (const [group, outputGroup, document] of inputs) {
    const normalized = normalizeOpenApiGroup(group, document);
    if (Object.keys(normalized.spec).length === 0) {
      throw new Error(`No compatible ${group} operations; refusing to replace bundled registry`);
    }
    const visible = applyVisibilityPolicy(normalized.spec, llmsEndpointKeys);
    if (Object.keys(visible.spec).length === 0) {
      throw new Error(`No visible ${group} operations; refusing to replace bundled registry`);
    }
    result[outputGroup] = visible.spec;
    console.log(
      `  ${group}: ${Object.keys(normalized.spec).length} compatible, ` +
      `${Object.keys(visible.spec).length} visible (${visible.mode}, ` +
      `${visible.usableLlmsCount} llms.txt matches)`,
    );
    for (const rejection of normalized.rejected) {
      const detail = rejection.detail ? ` (${rejection.detail})` : '';
      console.log(
        `    hidden incompatible operation: ${rejection.method} ${rejection.path} ` +
        `[${rejection.reason}]${detail}`,
      );
    }
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  const temporaryOutput = `${OUTPUT}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryOutput, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o644 });
    renameSync(temporaryOutput, OUTPUT);
  } finally {
    rmSync(temporaryOutput, { force: true });
  }
  console.log(`Written atomically to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
