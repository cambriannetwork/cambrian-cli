/**
 * Validates that CLI handler metadata (ALLOWED_OPTIONS, REQUIRED_OPTIONS)
 * matches the OpenAPI spec snapshot.
 *
 * With the dynamic handler approach, CLI flags ARE the API param names
 * in kebab-case (e.g., token_address → --token-address). The mapping
 * is always: kebab-case → snake_case.
 *
 * This test catches:
 * - Missing required flags
 * - Wrong param names
 * - Phantom flags that don't map to any API param
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SOLANA_RESOURCES,
  SOLANA_ALLOWED_OPTIONS,
  SOLANA_REQUIRED_OPTIONS,
} from '../src/cli/solana-handlers.js';
import {
  EVM_RESOURCES,
  EVM_ALLOWED_OPTIONS,
  EVM_REQUIRED_OPTIONS,
} from '../src/cli/evm-handlers.js';
import {
  RISK_RESOURCES,
  RISK_ALLOWED_OPTIONS,
  RISK_REQUIRED_OPTIONS,
} from '../src/cli/risk-handlers.js';
import {
  DEEP42_RESOURCES,
  DEEP42_ALLOWED_OPTIONS,
  DEEP42_REQUIRED_OPTIONS,
} from '../src/cli/deep42-handlers.js';
import {
  CAMBRIAN_MCP_TOOLS,
  CAMBRIAN_METADATA_GROUPS,
  buildCambrianToolName,
} from '../src/metadata.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(__dirname, '..', 'src', 'generated', 'openapi-params.json');

type ParamInfo = { required: boolean; type: string; enum?: string[]; default?: unknown };
type SpecEntry = { apiPath: string; method: string; params: Record<string, ParamInfo> };
type Spec = Record<string, Record<string, SpecEntry>>;

const spec: Spec = JSON.parse(readFileSync(specPath, 'utf-8'));

// ── Default mapping: kebab-case → snake_case ──────────────────────

function cliToApi(flag: string): string {
  return flag.replace(/-/g, '_');
}

// Params that the API marks required but the CLI provides a default.
// These should be in ALLOWED_OPTIONS but not necessarily REQUIRED_OPTIONS.
const CLI_DEFAULTS: Record<string, Record<string, string[]>> = {
  solana: {
    'orca-pools': ['dex'],
    'trending-tokens': ['order_by'],
  },
  evm: {
    'aero-v2-pool': ['apr_days_annualized'],
  },
  deep42: {},
};

function hasCliDefault(specGroup: string, resource: string, apiParam: string): boolean {
  return (CLI_DEFAULTS[specGroup]?.[resource] ?? []).includes(apiParam);
}

// ── Test runner ───────────────────────────────────────────────────

function testGroup(
  groupName: string,
  specGroup: string,
  resources: readonly string[] | string[],
  allowedOpts: Record<string, string[]>,
  requiredOpts: Record<string, string[]>,
) {
  const specEndpoints = spec[specGroup];
  if (!specEndpoints) {
    throw new Error(`No OpenAPI spec found for group "${specGroup}". Run: npm run sync-openapi`);
  }

  describe(`${groupName} handler metadata matches OpenAPI`, () => {
    it('every resource has ALLOWED_OPTIONS entry', () => {
      for (const resource of resources) {
        expect(allowedOpts, `Missing ALLOWED_OPTIONS for ${resource}`).toHaveProperty(resource);
      }
    });

    it('every resource has REQUIRED_OPTIONS entry', () => {
      for (const resource of resources) {
        expect(requiredOpts, `Missing REQUIRED_OPTIONS for ${resource}`).toHaveProperty(resource);
      }
    });

    for (const resource of resources) {
      const specEntry = specEndpoints[resource];
      if (!specEntry) continue;

      describe(`${groupName} ${resource}`, () => {
        const allowed = new Set(allowedOpts[resource] ?? []);
        const required = new Set(requiredOpts[resource] ?? []);
        const apiParams = specEntry.params;

        // Every REQUIRED API param must have a matching CLI flag
        it('every required API param is in ALLOWED_OPTIONS', () => {
          const missing: string[] = [];
          for (const [apiParam, info] of Object.entries(apiParams)) {
            if (!info.required) continue;
            const hasFlag = [...allowed].some((f) => cliToApi(f) === apiParam);
            if (!hasFlag) {
              missing.push(`API param "${apiParam}" has no CLI flag`);
            }
          }
          expect(missing, `Missing required flags:\n  ${missing.join('\n  ')}`).toHaveLength(0);
        });

        it('every required API param is in REQUIRED_OPTIONS (unless defaulted)', () => {
          const missing: string[] = [];
          for (const [apiParam, info] of Object.entries(apiParams)) {
            if (!info.required) continue;
            if (hasCliDefault(specGroup, resource, apiParam)) continue;
            if (info.default !== undefined) continue;
            const hasFlag = [...required].some((f) => cliToApi(f) === apiParam);
            if (!hasFlag) {
              missing.push(`API param "${apiParam}" not marked required`);
            }
          }
          expect(missing, `Not marked required:\n  ${missing.join('\n  ')}`).toHaveLength(0);
        });

        // Every CLI flag must map to an actual API param
        it('no phantom CLI flags', () => {
          const phantom: string[] = [];
          for (const cliFlag of allowed) {
            const apiParam = cliToApi(cliFlag);
            if (!apiParams[apiParam]) {
              phantom.push(`--${cliFlag} → ${apiParam}`);
            }
          }
          expect(phantom, `Phantom flags:\n  ${phantom.join('\n  ')}`).toHaveLength(0);
        });

        // Every API param (required OR optional) should have a CLI flag
        it('every API param is exposed in ALLOWED_OPTIONS', () => {
          const missing: string[] = [];
          for (const [apiParam] of Object.entries(apiParams)) {
            const hasFlag = [...allowed].some((f) => cliToApi(f) === apiParam);
            if (!hasFlag) {
              missing.push(`API param "${apiParam}" has no CLI flag`);
            }
          }
          expect(missing, `Missing flags for API params:\n  ${missing.join('\n  ')}`).toHaveLength(0);
        });

        it('REQUIRED_OPTIONS ⊆ ALLOWED_OPTIONS', () => {
          const orphaned = [...required].filter((f) => !allowed.has(f));
          expect(orphaned, `In REQUIRED but not ALLOWED: ${orphaned.join(', ')}`).toHaveLength(0);
        });
      });
    }
  });
}

// ── Run ───────────────────────────────────────────────────────────

testGroup('Solana', 'solana', SOLANA_RESOURCES, SOLANA_ALLOWED_OPTIONS, SOLANA_REQUIRED_OPTIONS);
testGroup('EVM', 'evm', EVM_RESOURCES, EVM_ALLOWED_OPTIONS, EVM_REQUIRED_OPTIONS);
testGroup('Deep42', 'deep42', DEEP42_RESOURCES, DEEP42_ALLOWED_OPTIONS, DEEP42_REQUIRED_OPTIONS);
testGroup('Risk', 'risk', RISK_RESOURCES, RISK_ALLOWED_OPTIONS, RISK_REQUIRED_OPTIONS);

describe('shared Cambrian metadata registry', () => {
  it('contains one MCP tool per public metadata resource', () => {
    const expectedCount = Object.values(CAMBRIAN_METADATA_GROUPS)
      .reduce((sum, group) => sum + group.resources.length, 0);
    expect(CAMBRIAN_MCP_TOOLS).toHaveLength(expectedCount);
  });

  it('uses canonical MCP tool names', () => {
    expect(buildCambrianToolName('base', 'chains')).toBe('cambrian_base_chains');
    expect(buildCambrianToolName('solana', 'price-current')).toBe('cambrian_solana_price_current');
    expect(buildCambrianToolName('deep42', 'social-data/alpha-tweet-detection'))
      .toBe('cambrian_deep42_social_data_alpha_tweet_detection');
    expect(buildCambrianToolName('risk', 'perp-risk-engine')).toBe('cambrian_risk_perp_risk_engine');
  });

  it('marks CLI-defaulted params optional for MCP metadata', () => {
    const aeroPool = CAMBRIAN_MCP_TOOLS.find((tool) => tool.name === 'cambrian_base_aero_v2_pool');
    const aprDays = aeroPool?.params.find((param) => param.name === 'apr_days_annualized');
    expect(aprDays?.required).toBe(false);

    const risk = CAMBRIAN_MCP_TOOLS.find((tool) => tool.name === 'cambrian_risk_perp_risk_engine');
    expect(risk?.params.every((param) => param.required === false)).toBe(true);
  });

  // These two deep42 endpoints exist in the deep42 OpenAPI spec but are hidden
  // from the public docs (docs.cambrian.org/llms.txt) and 404 on the live
  // gateway. They must NOT be exposed by the CLI/MCP. sync-openapi.mjs excludes
  // them; this guards against a regression re-introducing them.
  it('excludes the undocumented deep42 discovery/* endpoints', () => {
    const deep42 = CAMBRIAN_METADATA_GROUPS.deep42.resources;
    expect(deep42).not.toContain('discovery/project-metadata');
    expect(deep42).not.toContain('discovery/search-projects');
    expect(deep42.every((r) => r.startsWith('social-data/'))).toBe(true);
    expect(deep42).toHaveLength(5);
    expect(spec.deep42['discovery/project-metadata']).toBeUndefined();
    expect(spec.deep42['discovery/search-projects']).toBeUndefined();
    expect(CAMBRIAN_MCP_TOOLS.some((t) => t.resource.startsWith('discovery/'))).toBe(false);
  });
});
