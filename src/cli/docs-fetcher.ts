/**
 * Fetches documentation from docs.cambrian.org/llms.txt at the appropriate
 * level of specificity based on the command context.
 *
 * - `cambrian --help`                        → full llms.txt
 * - `cambrian solana --help`                 → Solana section from llms.txt
 * - `cambrian solana price-current --help`   → endpoint-specific llms.txt
 */

import { CAMBRIAN_METADATA_GROUPS, DEEP42_RESOURCE_ALIASES } from '../metadata.js';
import type {
  CambrianGroup,
  CambrianMetadataGroup,
  EndpointSpec,
  ParamSpec,
} from '../metadata.js';

const LLMS_BASE = 'https://docs.cambrian.org';
const LLMS_ROOT = `${LLMS_BASE}/llms.txt`;

// Map CLI group names to llms.txt section headers
const SECTION_HEADERS: Record<string, string> = {
  solana: '### Solana',
  evm: '### Evm',
  deep42: '### Deep42',
  risk: '### Perp risk engine',
};

type MetadataGroups = Record<CambrianGroup, CambrianMetadataGroup>;

function metadataGroupKey(group: string): CambrianGroup | undefined {
  if (group === 'evm' || group === 'base') return 'base';
  if (group === 'solana' || group === 'deep42' || group === 'risk') return group;
  return undefined;
}

/** Builds endpoint docs paths directly from the executable registry. */
function resourceToApiPath(
  group: string,
  resource: string,
  metadataGroups: MetadataGroups,
): string | null {
  const key = metadataGroupKey(group);
  if (!key) return null;
  const resolved = key === 'deep42' ? DEEP42_RESOURCE_ALIASES[resource] ?? resource : resource;
  const entry = metadataGroups[key].spec[resolved];
  if (!entry) return null;
  return entry.apiPath.replace(/^\/?api\/v1\//, '').replace(/^\//, '');
}

/**
 * Extract a section from the full llms.txt content.
 * Sections start with ### headers.
 */
function extractSection(fullText: string, sectionHeader: string): string {
  const lines = fullText.split('\n');
  let inSection = false;
  const result: string[] = [];

  for (const line of lines) {
    // Stop at next H2 or H3 section
    if (inSection && (line.startsWith('### ') || line.startsWith('## '))) {
      break;
    }
    if (line === sectionHeader) {
      inSection = true;
      result.push(line);
      continue;
    }
    if (inSection) {
      result.push(line);
    }
  }

  return result.join('\n').trim();
}

export type FetchFn = typeof globalThis.fetch;

/**
 * Fetch help documentation from llms.txt.
 * On any network/HTTP failure the function falls back to schema-derived info
 * from the bundled OpenAPI params. Never throws.
 *
 * Returns the documentation text, or null only when no fallback is available
 * (e.g. root-level fetch with no group specified).
 */
export async function fetchDocs(
  fetchFn: FetchFn,
  group?: string,
  resource?: string,
  metadataGroups: MetadataGroups = CAMBRIAN_METADATA_GROUPS,
  offline = false,
): Promise<string | null> {
  if (offline) return buildSchemaFallbackDocs(group, resource, metadataGroups);
  try {
    // Level 3: specific endpoint docs
    if (group && resource) {
      const apiPath = resourceToApiPath(group, resource, metadataGroups);
      if (apiPath) {
        const url = `${LLMS_BASE}/api/v1/${apiPath}/llms.txt`;
        let endpointText: string | null = null;
        try {
          const res = await fetchFn(url);
          if (res.ok) endpointText = await res.text();
        } catch {
          // network failure — proceed to root fallback below
        }
        if (endpointText) return endpointText;
        // Fall through: try root llms.txt, then schema fallback.
      }
    }

    // Level 1 or 2: fetch full llms.txt, then optionally extract section
    let fullText: string | null = null;
    try {
      const res = await fetchFn(LLMS_ROOT);
      if (res.ok) fullText = await res.text();
    } catch {
      // network failure — use schema fallback
    }

    if (fullText) {
      // Level 2: extract section for a specific group
      if (group && !resource) {
        const header = SECTION_HEADERS[group];
        if (header) {
          const section = extractSection(fullText, header);
          if (section) return section;
        }
      }
      // Level 1: full docs
      return fullText;
    }

    // Schema fallback: offline, derived from bundled OpenAPI params.
    return buildSchemaFallbackDocs(group, resource, metadataGroups);
  } catch {
    // Last resort: try schema fallback, then null.
    return buildSchemaFallbackDocs(group, resource, metadataGroups);
  }
}

// ── Schema-derived fallback (offline, from bundled OpenAPI schema) ──

// CLI group name -> metadata group key (evm/base both map to the `base` spec).
const GROUP_TO_METADATA_KEY: Record<string, CambrianGroup> = {
  solana: 'solana',
  evm: 'base',
  base: 'base',
  deep42: 'deep42',
  risk: 'risk',
};

function describeParam(name: string, ps: ParamSpec): string {
  const cliFlag = name.replace(/_/g, '-');
  const bits: string[] = [ps.type];
  if (ps.required) bits.push('required'); else bits.push('optional');
  if (ps.enum) bits.push(`one of: ${ps.enum.join(', ')}`);
  if (ps.default !== undefined) bits.push(`default: ${ps.default}`);
  if (ps.min !== undefined && ps.max !== undefined) bits.push(`range ${ps.min}-${ps.max}`);
  else if (ps.min !== undefined) bits.push(`min ${ps.min}`);
  else if (ps.max !== undefined) bits.push(`max ${ps.max}`);
  const meta = `  --${cliFlag}  (${bits.join(', ')})`;
  return ps.description ? `${meta}\n      ${ps.description}` : meta;
}

function renderEndpointSchema(group: string, resource: string, entry: EndpointSpec): string {
  const lines: string[] = [
    `# cambrian ${group} ${resource}`,
    '',
    '(Live docs unavailable — showing bundled schema. For full descriptions,',
    ' units, and response fields, retry `cambrian docs` when online or see',
    ` https://docs.cambrian.org/api/v1/${entry.apiPath.replace(/^\/api\/v1\//, '').replace(/^\//, '')}/llms.txt )`,
    '',
    `${entry.method} ${entry.apiPath}`,
    '',
  ];
  const params = Object.entries(entry.params);
  if (params.length === 0) {
    lines.push('Parameters: (none)');
  } else {
    lines.push('Parameters:');
    for (const [name, ps] of params) lines.push(describeParam(name, ps));
  }
  return lines.join('\n');
}

/**
 * Builds documentation from the bundled OpenAPI schema when the live llms.txt
 * fetch fails. Returns null if the group/resource can't be resolved from the
 * schema. Purely offline — never fetches, never throws.
 */
export function buildSchemaFallbackDocs(
  group?: string,
  resource?: string,
  metadataGroups: MetadataGroups = CAMBRIAN_METADATA_GROUPS,
): string | null {
  try {
    if (!group) return null;
    const metadataKey = GROUP_TO_METADATA_KEY[group];
    if (!metadataKey) return null;
    const groupMeta = metadataGroups[metadataKey];

    // Group-level fallback (no resource): list available resources.
    if (!resource) {
      const resources = groupMeta.resources;
      return [
        `# cambrian ${group}`,
        '',
        '(Live docs unavailable — showing bundled schema resource list.)',
        '',
        'Resources:',
        ...resources.map((r) => `  ${r}`),
        '',
        `Run "cambrian ${group} <resource> --help" for parameters.`,
      ].join('\n');
    }

    // Resolve Deep42 aliases (e.g. alpha-tweets -> social-data/...).
    const resolved =
      metadataKey === 'deep42'
        ? DEEP42_RESOURCE_ALIASES[resource] ?? resource
        : resource;

    const entry = groupMeta.spec[resolved];
    if (!entry) return null;
    return renderEndpointSchema(group, resource, entry);
  } catch {
    return null;
  }
}
