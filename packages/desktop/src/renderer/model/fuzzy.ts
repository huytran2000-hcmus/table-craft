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

export interface FuzzyMatch {
  readonly score: number;
  /** Where each query character landed in the text, ascending; for highlighting. */
  readonly positions: readonly number[];
}

/** The best match of `query` in `text`, or `null` when it does not match. Whitespace in the query is ignored. */
export function match(query: string, text: string): FuzzyMatch | null {
  const needle = query.replace(/\s+/g, "").toLowerCase();
  if (needle === "") return { score: 0, positions: [] };
  const haystack = text.toLowerCase();
  // current[j]: the best score with query character i matched at text[j]; origins[i][j] the text
  // index query character i - 1 matched at on that best path.
  const origins: number[][] = [];
  let previous: (number | null)[] = [];
  for (let i = 0; i < needle.length; i += 1) {
    const current: (number | null)[] = new Array<number | null>(haystack.length).fill(null);
    const origin: number[] = new Array<number>(haystack.length).fill(-1);
    let bestBefore: number | null = i === 0 ? 0 : null;
    let bestBeforeAt = -1;
    for (let j = 0; j < haystack.length; j += 1) {
      if (i > 0 && j > 0) {
        const candidate = previous[j - 1] ?? null;
        if (candidate !== null && (bestBefore === null || candidate > bestBefore)) {
          bestBefore = candidate;
          bestBeforeAt = j - 1;
        }
      }
      if (haystack[j] !== needle[i] || bestBefore === null) continue;
      const here = positionScore(text, j);
      const adjacent = i > 0 && j > 0 ? (previous[j - 1] ?? null) : null;
      const scattered = bestBefore + here;
      const run = adjacent === null ? null : adjacent + here + CONSECUTIVE_BONUS;
      if (run !== null && run > scattered) {
        current[j] = run;
        origin[j] = j - 1;
      } else {
        current[j] = scattered;
        origin[j] = bestBeforeAt;
      }
    }
    origins.push(origin);
    previous = current;
  }
  let best: number | null = null;
  let bestAt = -1;
  for (let j = 0; j < previous.length; j += 1) {
    const value = previous[j] ?? null;
    if (value !== null && (best === null || value > best)) {
      best = value;
      bestAt = j;
    }
  }
  if (best === null) return null;
  const positions: number[] = [];
  for (let i = needle.length - 1, at = bestAt; i >= 0; i -= 1) {
    positions.unshift(at);
    at = origins[i]?.[at] ?? -1;
  }
  return { score: best, positions };
}

/** The best score for `query` in `text`, or `null` when it does not match. Whitespace in the query is ignored. */
export function score(query: string, text: string): number | null {
  return match(query, text)?.score ?? null;
}
