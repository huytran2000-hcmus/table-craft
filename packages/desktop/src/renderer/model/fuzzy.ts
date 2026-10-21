/**
 * The palette's matcher: every query character must appear in order, and a match scores by where
 * its characters land. Word starts beat runs, runs beat scattered hits, so `nc` finds
 * "New Console" ahead of "Cancel".
 */

const TEXT_START_BONUS = 12;
const WORD_START_BONUS = 10;
const CONSECUTIVE_BONUS = 5;
const SCATTERED_SCORE = 1;
const WORD_SEPARATOR = /[\s._\-/:()[\]]/;

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text.charAt(index - 1);
  const current = text.charAt(index);
  if (WORD_SEPARATOR.test(previous)) return true;
  return previous === previous.toLowerCase() && current !== current.toLowerCase();
}

function positionScore(text: string, index: number): number {
  if (index === 0) return TEXT_START_BONUS;
  return isWordStart(text, index) ? WORD_START_BONUS : SCATTERED_SCORE;
}

/** The best score for `query` in `text`, or `null` when it does not match. Whitespace in the query is ignored. */
export function score(query: string, text: string): number | null {
  const needle = query.replace(/\s+/g, "").toLowerCase();
  if (needle === "") return 0;
  const haystack = text.toLowerCase();
  // best[j]: the best score with the current query character matched at text[j].
  let previous: (number | null)[] = [];
  for (let i = 0; i < needle.length; i += 1) {
    const current: (number | null)[] = new Array<number | null>(haystack.length).fill(null);
    let bestBefore: number | null = i === 0 ? 0 : null;
    for (let j = 0; j < haystack.length; j += 1) {
      if (i > 0 && j > 0) {
        const candidate = previous[j - 1] ?? null;
        if (candidate !== null && (bestBefore === null || candidate > bestBefore)) bestBefore = candidate;
      }
      if (haystack[j] !== needle[i] || bestBefore === null) continue;
      const here = positionScore(text, j);
      const adjacent = i > 0 && j > 0 ? (previous[j - 1] ?? null) : null;
      current[j] = Math.max(bestBefore + here, adjacent === null ? 0 : adjacent + here + CONSECUTIVE_BONUS);
    }
    previous = current;
  }
  let best: number | null = null;
  for (const value of previous) if (value !== null && (best === null || value > best)) best = value;
  return best;
}
