/**
 * Typo suggestions for unknown commands/resources, mirroring the approach used
 * by cobra (gh/kubectl) and git's `help.autocorrect`: suggest a known name when
 * it is within a small Levenshtein distance of the input, or when the input is a
 * case-insensitive prefix of it.
 */

/** Maximum edit distance at which we still offer a suggestion. */
export const SUGGESTION_MAX_DISTANCE = 2;

/**
 * Levenshtein edit distance between two strings (insert/delete/substitute, cost
 * 1 each). Iterative two-row dynamic programming — O(n*m) time, O(min) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/**
 * Returns known candidates that are plausible corrections of `input`, ranked by
 * edit distance (closest first). A candidate qualifies when its distance to the
 * input is ≤ {@link SUGGESTION_MAX_DISTANCE}, or when the input is a
 * case-insensitive prefix of it. Comparison is case-insensitive.
 */
export function suggestMatches(input: string, candidates: readonly string[]): string[] {
  const needle = input.toLowerCase();
  return candidates
    .map((candidate) => {
      const lower = candidate.toLowerCase();
      const distance = levenshtein(needle, lower);
      const isPrefix = needle.length > 0 && lower.startsWith(needle);
      return { candidate, distance, qualifies: distance <= SUGGESTION_MAX_DISTANCE || isPrefix };
    })
    .filter((m) => m.qualifies)
    .sort((a, b) => a.distance - b.distance)
    .map((m) => m.candidate);
}

/**
 * Builds a "Did you mean …?" clause for the closest matches, or '' when there is
 * no plausible suggestion. Limits to the top {@link limit} matches.
 */
export function didYouMean(input: string, candidates: readonly string[], limit = 3): string {
  const matches = suggestMatches(input, candidates).slice(0, limit);
  if (matches.length === 0) return '';
  const list = matches.map((m) => `"${m}"`).join(', ');
  return ` Did you mean ${list}?`;
}
