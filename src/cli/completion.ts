/**
 * Shell completion (Phase 3 #6), npm-style: `cambrian completion <shell>` emits
 * a static shell stub that delegates to a hidden `cambrian __complete <words…>`,
 * which prints newline-separated candidates derived from the bundled metadata.
 * No framework, no dependencies.
 */

import { CAMBRIAN_METADATA_GROUPS } from '../metadata.js';
import type { CambrianGroup } from '../metadata.js';
import { CliUsageError } from './core.js';

export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

/** Top-level commands offered for completion (hidden `__complete` excluded). */
const TOP_LEVEL = [
  'solana', 'base', 'evm', 'deep42', 'risk', 'pay',
  'docs', 'config', 'completion', 'skill', 'mcp', 'describe',
];

const GLOBAL_FLAGS = [
  '--json', '--output', '--fields', '--all', '--max-items',
  '--timeout', '--retries', '--api-key', '--help',
];

/** Data groups payable via `cambrian pay <group> <resource>`. */
const PAY_GROUPS = ['solana', 'base', 'evm', 'deep42', 'risk'];
const PAY_FLAGS = ['--yes', '--max-amount', '--output', '--fields', '--help'];

function startsWithFilter(candidates: string[], prefix: string): string[] {
  if (!prefix) return candidates;
  return candidates.filter((c) => c.startsWith(prefix));
}

/** Maps a CLI group token to its metadata group key ('evm' → 'base'). */
function metadataGroupKey(group: string): CambrianGroup | undefined {
  if (group === 'evm' || group === 'base') return 'base';
  if (group === 'solana' || group === 'deep42' || group === 'risk') return group;
  return undefined;
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
export function complete(words: string[]): string[] {
  const args = words.length === 0 ? [''] : words;

  // Completing the group/command token.
  if (args.length <= 1) {
    return startsWithFilter(TOP_LEVEL, args[0] ?? '');
  }

  // `pay <group> <resource> [flags]` — one token deeper than the data commands.
  if (args[0] === 'pay') {
    if (args.length === 2) return startsWithFilter(PAY_GROUPS, args[1] ?? '');
    const payGroupKey = metadataGroupKey(args[1]);
    if (!payGroupKey) return [];
    const payMeta = CAMBRIAN_METADATA_GROUPS[payGroupKey];
    if (args.length === 3) return startsWithFilter(payMeta.resources, args[2] ?? '');
    const payEntry = payMeta.spec[args[2]];
    const payResourceFlags = payEntry
      ? Object.keys(payEntry.params).map((p) => `--${p.replace(/_/g, '-')}`)
      : [];
    return startsWithFilter([...payResourceFlags, ...PAY_FLAGS], args[args.length - 1] ?? '');
  }

  const groupKey = metadataGroupKey(args[0]);
  if (!groupKey) return [];
  const meta = CAMBRIAN_METADATA_GROUPS[groupKey];

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
# Install:  cambrian completion bash >> ~/.bashrc   (then restart your shell)
_cambrian() {
  local words
  words=("\${COMP_WORDS[@]:1:COMP_CWORD}")
  local IFS=$'\\n'
  COMPREPLY=( $(cambrian __complete "\${words[@]}" 2>/dev/null) )
}
complete -F _cambrian cambrian`;

const ZSH_STUB = `# cambrian zsh completion
# Install:  cambrian completion zsh >> ~/.zshrc   (then restart your shell)
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
