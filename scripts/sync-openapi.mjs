#!/usr/bin/env node

/**
 * Fetches OpenAPI specs from all Cambrian API services and produces
 * a normalized JSON snapshot mapping CLI resource names → expected parameters.
 *
 * Output: src/generated/openapi-params.json
 *
 * Run: npm run sync-openapi
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '..', 'src', 'generated', 'openapi-params.json');

/**
 * Resources present in a service's OpenAPI spec but intentionally NOT exposed by
 * the CLI: they are hidden from the public docs (docs.cambrian.org/llms.txt) and
 * are not deployed on the live gateway (they return 404). Keyed by
 * `<group>:<resource>`. Keep this in sync with llms.txt.
 */
const EXCLUDED_RESOURCES = new Set([
  'deep42:discovery/project-metadata',
  'deep42:discovery/search-projects',
]);

const SPECS = [
  { url: 'https://opabinia.cambrian.network/openapi.json', prefix: '/api/v1/' },
  { url: 'https://deep42.cambrian.network/openapi.json', prefix: '/api/v1/deep42/' },
  { url: 'https://risk.cambrian.network/openapi.json', prefix: '/api/v1/' },
];

/** Convert an API path to a { group, resource } pair.
 *  /api/v1/solana/orca/pools/liquidity-map → { group: 'solana', resource: 'orca-pools-liquidity-map' }
 *  /api/v1/evm/aero/v2/pool               → { group: 'evm', resource: 'aero-v2-pool' }
 *  /api/v1/perp-risk-engine               → { group: 'risk', resource: 'perp-risk-engine' }
 *  /api/v1/deep42/social-data/alpha-tweet-detection → { group: 'deep42', resource: 'social-data/alpha-tweet-detection' }
 */
function pathToGroupResource(apiPath) {
  // Skip catch-all and parameterized paths
  if (apiPath.includes('{')) return null;

  // Strip /api/v1/ or api/v1/ prefix (risk spec omits leading slash)
  const stripped = apiPath.replace(/^\/?api\/v1\//, '');

  // Risk endpoint has no group prefix
  if (stripped === 'perp-risk-engine') {
    return { group: 'risk', resource: 'perp-risk-engine' };
  }

  // Skip stats
  if (stripped === 'stats') return null;

  // Deep42: keep slash-separated paths
  if (stripped.startsWith('deep42/')) {
    return { group: 'deep42', resource: stripped.replace('deep42/', '') };
  }

  // Solana and EVM: first segment is group, rest becomes dash-separated resource
  const segments = stripped.split('/');
  const group = segments[0]; // 'solana' or 'evm'
  if (group !== 'solana' && group !== 'evm') return null;
  const resourceParts = segments.slice(1);
  const resource = resourceParts.join('-');

  return { group, resource };
}

function extractParams(operation) {
  const params = {};
  for (const p of operation.parameters || []) {
    if (p.in !== 'query') continue;
    const schema = p.schema || {};
    const entry = {
      required: p.required === true,
      type: schema.type || 'string',
    };
    if (schema.enum) entry.enum = schema.enum;
    if (schema.minimum !== undefined) entry.min = schema.minimum;
    if (schema.maximum !== undefined) entry.max = schema.maximum;
    if (schema.default !== undefined) entry.default = schema.default;
    params[p.name] = entry;
  }
  return params;
}

async function fetchSpec(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

async function main() {
  const result = {};

  for (const { url } of SPECS) {
    console.log(`Fetching ${url} ...`);
    let spec;
    try {
      spec = await fetchSpec(url);
    } catch (err) {
      console.error(`  WARN: ${err.message} — skipping`);
      continue;
    }

    const paths = spec.paths || {};
    for (const [apiPath, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (method === 'parameters' || method === 'servers') continue;
        if (typeof operation !== 'object' || !operation) continue;

        const parsed = pathToGroupResource(apiPath);
        if (!parsed) continue;
        const { group, resource } = parsed;
        if (EXCLUDED_RESOURCES.has(`${group}:${resource}`)) continue;

        if (!result[group]) result[group] = {};
        result[group][resource] = {
          apiPath,
          method: method.toUpperCase(),
          params: extractParams(operation),
        };
      }
    }
  }

  // Summary
  for (const [group, resources] of Object.entries(result)) {
    console.log(`  ${group}: ${Object.keys(resources).length} endpoints`);
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + '\n');
  console.log(`\nWritten to ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
