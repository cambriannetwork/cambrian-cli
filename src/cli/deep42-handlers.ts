import {
  CliUsageError,
  hasOption,
  optionalOptionValue,
  type ParsedArgs,
  type Runtime,
} from './core.js';
import type { CambrianData } from '../client/index.js';
import { loadVersionedGroupSpec } from '../schema/registry.js';
import {
  deriveCliMetadata,
  handleDynamicQuery,
  buildCategorizedHelp,
  DATA_OUTPUT_GLOBAL_OPTIONS,
} from './dynamic-handler.js';
import {
  CAMBRIAN_METADATA_GROUPS,
  DEEP42_RESOURCE_ALIASES,
  type CambrianMetadataGroup,
  type EndpointSpec,
  type GroupSpec,
} from '../metadata.js';

// ── Load spec and derive CLI metadata ────────────────────────────

const { spec, cliDefaults: DEEP42_CLI_DEFAULTS } = CAMBRIAN_METADATA_GROUPS.deep42;

const { resources, allowedOptions, requiredOptions } = deriveCliMetadata(spec, DEEP42_CLI_DEFAULTS);

export const DEEP42_RESOURCES = resources;
export const DEEP42_ALLOWED_OPTIONS = allowedOptions;
export const DEEP42_REQUIRED_OPTIONS = requiredOptions;

// ── Categorized help ─────────────────────────────────────────────

const DEEP42_GLOBAL_OPTIONS = ['help', 'api-key', 'api-version', 'base-url', 'json', 'timeout', 'retries', 'offline', ...DATA_OUTPUT_GLOBAL_OPTIONS];

function getDeep42Category(resource: string): string {
  if (resource.startsWith('discovery/')) return 'Discovery';
  if (resource.startsWith('social-data/')) return 'Social Data';
  return 'Other';
}

function deep42Help(currentResources: string[]): string {
  // Derive the alias list from the registry so it never drifts from the actual aliases.
  const aliases = Object.keys(DEEP42_RESOURCE_ALIASES);
  const aliasLines: string[] = [];
  for (let i = 0; i < aliases.length; i += 4) {
    aliasLines.push('  ' + aliases.slice(i, i + 4).join(', '));
  }
  return buildCategorizedHelp(currentResources, getDeep42Category, 'deep42', {
    categoryOrder: ['Social Data', 'Discovery'],
    extraLines: [
      'Aliases:',
      ...aliasLines,
      '',
      'API versions:',
      '  Without --api-version, each resource uses the default API version. A new version',
      '  is queued and becomes the default on a published date. Use --api-version <version>,',
      '  such as 4.1.0, to try a queued version early or to stay on an earlier one.',
      '  "cambrian deep42 <resource> --help" lists the versions and their dates.',
    ],
  });
}

// ── API versions ─────────────────────────────────────────────────

const API_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Help text that names the default version, the queued versions with the date
 * each becomes the default, and the earlier versions that stay selectable.
 */
export function versionHelpNotes(
  entry: EndpointSpec,
  selected: string | undefined,
  now: number = Date.now(),
): string[] {
  if (!entry.versions?.length) return [];
  const listed = entry.versions.find((v) => v.isDefault)?.version;
  // A cached schema can predate a scheduled date; the API then uses the newest version past its date.
  const promoted = entry.versions
    .filter((v) => Date.parse(v.becomesDefaultAt ?? '') <= now
      && (!listed || compareVersions(v.version, listed) > 0))
    .sort((a, b) => compareVersions(a.version, b.version))
    .pop()?.version;
  const current = promoted ?? listed;
  const ascending = [...entry.versions].sort((a, b) => compareVersions(a.version, b.version));
  const later = ascending.filter((v) => !current || compareVersions(v.version, current) > 0);
  const earlier = current
    ? ascending.filter((v) => compareVersions(v.version, current) < 0).map((v) => v.version).reverse()
    : [];
  const lines = ['API versions (select one with --api-version <version>):'];
  if (current) lines.push(`  ${current}  default: used when --api-version is not set`);
  for (const v of later) {
    const at = v.becomesDefaultAt ? Date.parse(v.becomesDefaultAt) : Number.NaN;
    lines.push(Number.isFinite(at) && at > now
      ? `  ${v.version}  queued: becomes the default on ${new Date(at).toISOString().slice(0, 10)}`
      : `  ${v.version}  available: not scheduled to become the default`);
  }
  if (earlier.length > 0) lines.push(`  ${earlier.join(', ')}  earlier versions`);
  lines.push(selected
    ? `The options above are for API version ${selected}.`
    : `The options above are for the default version${current ? ` (${current})` : ''}. ` +
      'Add --api-version <version> to --help to see the options of another version.');
  return [lines.join('\n')];
}

/** Replaces the resource's entry with the schema of the requested API version. */
async function specForApiVersion(
  resource: string,
  version: string,
  spec: GroupSpec,
  parsed: ParsedArgs,
  runtime: Runtime,
): Promise<GroupSpec> {
  const entry = spec[resource];
  if (!entry) return spec; // The dynamic handler reports the unknown resource.
  if (!API_VERSION_PATTERN.test(version)) {
    throw new CliUsageError('--api-version must be a full version such as 4.1.0.');
  }
  const offered = entry.versions?.map((v) => v.version);
  if (offered && !offered.includes(version)) {
    throw new CliUsageError(
      `deep42 ${resource} does not offer API version ${version}. ` +
        `Offered versions: ${offered.join(', ')}. ` +
        `Run "cambrian deep42 ${resource} --help" to see the default and queued versions.`,
    );
  }
  if (hasOption(parsed, 'offline') || runtime.env.CAMBRIAN_SCHEMA_MODE?.trim().toLowerCase() === 'bundled') {
    throw new CliUsageError(
      '--api-version reads the schema of that version from the API. Remove --offline ' +
        '(and CAMBRIAN_SCHEMA_MODE=bundled) to use it.',
    );
  }
  const versioned = (await loadVersionedGroupSpec('deep42', version, runtime))?.[resource];
  if (!versioned) {
    throw new CliUsageError(`deep42 ${resource} does not offer API version ${version}.`);
  }
  return { ...spec, [resource]: { ...versioned, versions: versioned.versions ?? entry.versions } };
}

// ── Handler ──────────────────────────────────────────────────────

export async function handleDeep42Query(
  resource: string,
  parsed: ParsedArgs,
  runtime: Runtime,
  client: CambrianData,
  metadata: CambrianMetadataGroup = CAMBRIAN_METADATA_GROUPS.deep42,
): Promise<number> {
  const resolvedResource = DEEP42_RESOURCE_ALIASES[resource] ?? resource;
  const apiVersion = optionalOptionValue(parsed, 'api-version');
  const currentSpec = apiVersion && resolvedResource
    ? await specForApiVersion(resolvedResource, apiVersion, metadata.spec, parsed, runtime)
    : metadata.spec;
  const currentDefaults = metadata.cliDefaults;
  const current = deriveCliMetadata(currentSpec, currentDefaults);
  try {
    return await handleDynamicQuery(
      resolvedResource,
      parsed,
      runtime,
      (path, params) => client.deep42.query(
        path,
        params as Record<string, string | number | boolean | undefined>,
        undefined,
        { apiVersion },
      ),
      currentSpec,
      'deep42',
      DEEP42_GLOBAL_OPTIONS,
      currentDefaults,
      current.allowedOptions,
      current.requiredOptions,
      () => deep42Help(current.resources),
      (r) => (currentSpec[r] ? versionHelpNotes(currentSpec[r], apiVersion) : []),
    );
  } catch (error) {
    // An option can belong to another version (4.1.0 adds --handle), so say where to look.
    const versionCount = currentSpec[resolvedResource]?.versions?.length ?? 0;
    if (error instanceof CliUsageError && error.message.startsWith('Unknown option') && versionCount > 1) {
      throw new CliUsageError(
        `${error.message} Another API version may offer it. Run "cambrian deep42 ${resolvedResource} --help" ` +
          'to see the versions, then add --api-version <version> to --help to see its options.',
      );
    }
    throw error;
  }
}
