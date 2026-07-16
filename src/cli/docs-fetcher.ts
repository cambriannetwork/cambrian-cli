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

interface ResolvedEndpoint {
  entry: EndpointSpec;
  cliDefaults: Record<string, string>;
}

function metadataGroupKey(group: string): CambrianGroup | undefined {
  if (group === 'evm' || group === 'base') return 'base';
  if (group === 'solana' || group === 'deep42' || group === 'risk') return group;
  return undefined;
}

function resolveEndpoint(
  group: string,
  resource: string,
  metadataGroups: MetadataGroups,
): ResolvedEndpoint | null {
  const key = metadataGroupKey(group);
  if (!key) return null;
  const resolved = key === 'deep42' ? DEEP42_RESOURCE_ALIASES[resource] ?? resource : resource;
  const entry = metadataGroups[key].spec[resolved];
  return entry ? { entry, cliDefaults: metadataGroups[key].cliDefaults[resolved] ?? {} } : null;
}

/** Builds endpoint docs paths directly from the executable registry. */
function resourceToApiPath(
  group: string,
  resource: string,
  metadataGroups: MetadataGroups,
): string | null {
  const endpoint = resolveEndpoint(group, resource, metadataGroups);
  if (!endpoint) return null;
  return endpoint.entry.apiPath.replace(/^\/?api\/v1\//, '').replace(/^\//, '');
}

/** Removes llms.txt parameter tables so they cannot override OpenAPI constraints. */
function withoutParameterSections(text: string): string {
  const result: string[] = [];
  let skippedHeadingLevel: number | null = null;
  for (const line of text.split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (skippedHeadingLevel !== null) {
      if (!heading || heading[1].length > skippedHeadingLevel) continue;
      skippedHeadingLevel = null;
    }
    if (heading && /\bparameters\b/i.test(heading[2])) {
      skippedHeadingLevel = heading[1].length;
      continue;
    }
    result.push(line);
  }
  return result.join('\n').trim();
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
 * from the active cached/bundled OpenAPI metadata. Never throws.
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
        if (endpointText) {
          const endpoint = resolveEndpoint(group, resource, metadataGroups);
          if (endpoint) {
            return renderLiveEndpointDocs(
              group,
              resource,
              endpoint.entry,
              endpoint.cliDefaults,
              endpointText,
            );
          }
          return endpointText;
        }
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

    // Schema fallback: offline, derived from active cached/bundled metadata.
    return buildSchemaFallbackDocs(group, resource, metadataGroups);
  } catch {
    // Last resort: try schema fallback, then null.
    return buildSchemaFallbackDocs(group, resource, metadataGroups);
  }
}

// ── Schema-derived fallback (offline, from active OpenAPI metadata) ──

// CLI group name -> metadata group key (evm/base both map to the `base` spec).
const GROUP_TO_METADATA_KEY: Record<string, CambrianGroup> = {
  solana: 'solana',
  evm: 'base',
  base: 'base',
  deep42: 'deep42',
  risk: 'risk',
};

function describeParam(name: string, ps: ParamSpec, cliDefault?: string): string {
  const cliFlag = name.replace(/_/g, '-');
  const bits: string[] = [ps.type];
  if (ps.required && cliDefault === undefined) bits.push('required'); else bits.push('optional');
  if (ps.enum) bits.push(`one of: ${ps.enum.join(', ')}`);
  if (ps.default !== undefined) bits.push(`default: ${ps.default}`);
  else if (cliDefault !== undefined) bits.push(`CLI compatibility default: ${cliDefault}`);
  if (ps.min !== undefined && ps.max !== undefined) bits.push(`range ${ps.min}-${ps.max}`);
  else if (ps.min !== undefined) bits.push(`min ${ps.min}`);
  else if (ps.max !== undefined) bits.push(`max ${ps.max}`);
  if (ps.pattern) bits.push(`pattern ${ps.pattern}`);
  const meta = `  --${cliFlag}  (${bits.join(', ')})`;
  return ps.description ? `${meta}\n      ${ps.description}` : meta;
}

function renderExecutableContract(
  group: string,
  resource: string,
  entry: EndpointSpec,
  cliDefaults: Record<string, string>,
): string {
  const lines = [
    `# cambrian ${group} ${resource}`,
    '',
    '## Authoritative executable contract',
    '',
    'Flags, required fields, defaults, enums, patterns, and numeric limits below',
    'come from the active OpenAPI schema registry and govern CLI validation/execution.',
    'Any labeled CLI compatibility default is used only while that schema accepts it.',
    '',
    `${entry.method} ${entry.apiPath}`,
    '',
  ];
  const params = Object.entries(entry.params);
  if (params.length === 0) {
    lines.push('Parameters: (none)');
  } else {
    lines.push('Parameters:');
    for (const [name, ps] of params) lines.push(describeParam(name, ps, cliDefaults[name]));
  }
  return lines.join('\n');
}

function renderEndpointSchema(
  group: string,
  resource: string,
  entry: EndpointSpec,
  cliDefaults: Record<string, string>,
): string {
  return [
    renderExecutableContract(group, resource, entry, cliDefaults),
    '',
    '(Live llms.txt documentation unavailable. The executable contract above',
    ' remains usable; retry `cambrian docs` online for response-field semantics',
    ' and examples.)',
  ].join('\n');
}

function renderLiveEndpointDocs(
  group: string,
  resource: string,
  entry: EndpointSpec,
  cliDefaults: Record<string, string>,
  llmsText: string,
): string {
  const supplementary = withoutParameterSections(llmsText);
  return [
    renderExecutableContract(group, resource, entry, cliDefaults),
    '',
    '## Supplementary llms.txt documentation',
    '',
    'The narrative, examples, and response semantics below are supplementary.',
    'If they conflict with executable parameters, the OpenAPI contract above wins.',
    ...(supplementary ? ['', supplementary] : []),
  ].join('\n');
}

/**
 * Builds documentation from active cached/bundled OpenAPI metadata when llms.txt
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
        '(Live docs unavailable — showing active schema resource list.)',
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
    return renderEndpointSchema(
      group,
      resource,
      entry,
      groupMeta.cliDefaults[resolved] ?? {},
    );
  } catch {
    return null;
  }
}
