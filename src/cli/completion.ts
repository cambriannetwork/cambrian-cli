/**
 * Shell completion (Phase 3 #6), npm-style: `cambrian completion <shell>` emits
 * a static shell stub that delegates to a hidden `cambrian __complete <words…>`,
 * which prints newline-separated candidates derived from the bundled metadata.
 * No framework, no dependencies.
 */

import { CAMBRIAN_METADATA_GROUPS } from '../metadata.js';
import type { CambrianGroup, CambrianMetadataGroup } from '../metadata.js';
import { CliUsageError } from './core.js';
import {
  discoverEvmChains,
  evmChainForToken,
  projectEvmChain,
} from './evm-chains.js';

export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

/** Non-chain top-level commands offered for completion (hidden `__complete` excluded). */
const STATIC_TOP_LEVEL = [
  'solana', 'deep42', 'risk', 'pay',
  'docs', 'config', 'completion', 'schema', 'skill', 'mcp', 'describe',
];

const GLOBAL_FLAGS = [
  '--json', '--output', '--fields', '--all', '--max-items',
  '--timeout', '--retries', '--api-key', '--offline', '--help',
];

const PAY_FLAGS = ['--yes', '--max-amount', '--timeout', '--output', '--fields', '--offline', '--help'];

function startsWithFilter(candidates: string[], prefix: string): string[] {
  if (!prefix) return candidates;
  return candidates.filter((c) => c.startsWith(prefix));
}

/** Maps a CLI group token to its metadata group key ('evm'/'arbitrum' → 'base'). */
function metadataGroupKey(group: string): CambrianGroup | undefined {
  if (evmChainForToken(group)) return 'base';
  if (group === 'solana' || group === 'deep42' || group === 'risk') return group;
  return undefined;
}

/** Resolves the projection a CLI group token should complete against. */
function completionMetadata(
  token: string,
  metadataGroups: Record<CambrianGroup, CambrianMetadataGroup>,
): CambrianMetadataGroup | undefined {
  const chain = evmChainForToken(token);
  if (chain) return projectEvmChain(metadataGroups.base, chain);
  const key = metadataGroupKey(token);
  return key ? metadataGroups[key] : undefined;
}

/** Every group token offered by completion: static + advertised EVM chains. */
function groupTokens(metadataGroups: Record<CambrianGroup, CambrianMetadataGroup>): string[] {
  const chains = discoverEvmChains(metadataGroups.base);
  return [
    'solana',
    ...chains.map((chain) => chain.command),
    'deep42',
    'risk',
    'pay',
    'docs',
    'config',
    'completion',
    'schema',
    'skill',
    'mcp',
    'describe',
  ];
}

/**
 * Computes completion candidates for `words` — the tokens after `cambrian`, the
 * last of which may be a partial token being typed (possibly empty).
 *
 *   []                     → []                (handled as top-level below)
 *   ['sol']                → top-level matches
 *   ['solana', 'tok']      → solana resources starting with 'tok'
 *   ['solana','tokens','--'] → that resource's flags + globals
 */
export function complete(
  words: string[],
  metadataGroups: Record<CambrianGroup, CambrianMetadataGroup> = CAMBRIAN_METADATA_GROUPS,
): string[] {
  const args = words.length === 0 ? [''] : words;
  const chains = discoverEvmChains(metadataGroups.base);
  const evmTokens = chains.map((chain) => chain.command);
  const schemaGroups = ['solana', ...evmTokens, 'deep42', 'risk'];

  // Completing the group/command token.
  if (args.length <= 1) {
    return startsWithFilter(groupTokens(metadataGroups), args[0] ?? '');
  }

  if (args[0] === 'schema') {
    const subcommands = ['chains', 'status', 'refresh', 'clear-cache'];
    if (args.length === 2) return startsWithFilter(subcommands, args[1] ?? '');
    if (args.length === 3 && subcommands.includes(args[1])) {
      return startsWithFilter(schemaGroups, args[2] ?? '');
    }
    return [];
  }

  if (args[0] === 'docs') {
    if (args.length === 2) {
      const groups = [...schemaGroups, 'guides'];
      return startsWithFilter(groups, args[1] ?? '');
    }
    const docsMeta = completionMetadata(args[1], metadataGroups);
    if (args.length === 3 && docsMeta) {
      return startsWithFilter(docsMeta.resources, args[2] ?? '');
    }
    return [];
  }

  if (args[0] === 'config') {
    return args.length === 2
      ? startsWithFilter(['status', 'set-key', 'get-key', 'clear'], args[1] ?? '')
      : [];
  }

  // `pay <group> <resource> [flags]` — one token deeper than the data commands.
  if (args[0] === 'pay') {
    if (args.length === 2) return startsWithFilter(['solana', ...evmTokens, 'deep42', 'risk'], args[1] ?? '');
    const payMeta = completionMetadata(args[1], metadataGroups);
    if (!payMeta) return [];
    if (args.length === 3) return startsWithFilter(payMeta.resources, args[2] ?? '');
    const payEntry = payMeta.spec[args[2]];
    const payResourceFlags = payEntry
      ? Object.keys(payEntry.params).map((p) => `--${p.replace(/_/g, '-')}`)
      : [];
    return startsWithFilter([...payResourceFlags, ...PAY_FLAGS], args[args.length - 1] ?? '');
  }

  const meta = completionMetadata(args[0], metadataGroups);
  if (!meta) return [];

  // Completing the resource token.
  if (args.length === 2) {
    return startsWithFilter(meta.resources, args[1] ?? '');
  }

  // Completing flags for a chosen resource.
  const resource = args[1];
  const entry = meta.spec[resource];
  const last = args[args.length - 1] ?? '';
  const resourceFlags = entry
    ? Object.keys(entry.params).map((p) => `--${p.replace(/_/g, '-')}`)
    : [];
  return startsWithFilter([...resourceFlags, ...GLOBAL_FLAGS], last);
}

/** Renders the static shell stub for the given shell. */
export function completionScript(shell: CompletionShell): string {
  if (shell === 'bash') return BASH_STUB;
  if (shell === 'zsh') return ZSH_STUB;
  return FISH_STUB;
}

/** Validates a shell argument, throwing a usage error listing the choices. */
export function assertCompletionShell(value: string | undefined): CompletionShell {
  const normalized = (value ?? '').trim().toLowerCase();
  if ((COMPLETION_SHELLS as readonly string[]).includes(normalized)) {
    return normalized as CompletionShell;
  }
  throw new CliUsageError(
    `Usage: cambrian completion <${COMPLETION_SHELLS.join('|')}>`,
  );
}

const BASH_STUB = `# cambrian bash completion
# Install (Run once): cambrian completion bash >> ~/.bashrc   (then restart your shell)
_cambrian() {
  local words
  words=("\${COMP_WORDS[@]:1:COMP_CWORD}")
  local IFS=$'\\n'
  COMPREPLY=( $(cambrian __complete "\${words[@]}" 2>/dev/null) )
}
complete -F _cambrian cambrian`;

const ZSH_STUB = `# cambrian zsh completion
# Install (Run once): cambrian completion zsh >> ~/.zshrc   (then restart your shell)
autoload -U +X bashcompinit && bashcompinit
_cambrian() {
  local words
  words=("\${COMP_WORDS[@]:1:COMP_CWORD}")
  local IFS=$'\\n'
  COMPREPLY=( $(cambrian __complete "\${words[@]}" 2>/dev/null) )
}
complete -F _cambrian cambrian`;

const FISH_STUB = `# cambrian fish completion
# Install:  cambrian completion fish > ~/.config/fish/completions/cambrian.fish
function __cambrian_complete
  set -l tokens (commandline -opc) (commandline -ct)
  cambrian __complete $tokens[2..-1] 2>/dev/null
end
complete -c cambrian -f -a '(__cambrian_complete)'`;
