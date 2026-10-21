import { match } from "@table-craft/desktop/renderer/model/fuzzy.js";

/** Longer than any name worth typing; the field stops taking characters here. */
export const SPEED_SEARCH_MAX_LENGTH = 64;

export interface SpeedSearchMatch {
  /** The row's index in the list searched. */
  readonly index: number;
  /** The matched characters of its label, for highlighting. */
  readonly positions: readonly number[];
}

/**
 * The rows whose label matches `query`, in row order. The tree passes the rows it shows, which
 * are all loaded, so speed search never introspects anything.
 */
export function speedSearchMatches(labels: readonly string[], query: string): readonly SpeedSearchMatch[] {
  if (query.trim() === "") return [];
  return labels.flatMap((label, index) => {
    const positions = substringPositions(label, query) ?? match(query, label)?.positions;
    return positions === undefined ? [] : [{ index, positions }];
  });
}

/**
 * The palette's scorer prefers word starts, so it would light `cust` in "customer_totals" as
 * `cus…t`; a name containing what was typed reads better highlighted as that one run.
 */
function substringPositions(label: string, query: string): readonly number[] | null {
  const needle = query.replace(/\s+/g, "").toLowerCase();
  const at = label.toLowerCase().indexOf(needle);
  return at === -1 ? null : Array.from({ length: needle.length }, (_, offset) => at + offset);
}

/** The match after (or before) the row at `from`, wrapping around; `null` when nothing matches. */
export function stepMatch(matches: readonly SpeedSearchMatch[], from: number, direction: 1 | -1): number | null {
  if (matches.length === 0) return null;
  if (direction === 1) return (matches.find((found) => found.index > from) ?? matches[0])?.index ?? null;
  const before = matches.filter((found) => found.index < from);
  return (before[before.length - 1] ?? matches[matches.length - 1])?.index ?? null;
}

/** The match to select while typing: the selected row if it still matches, else the first after it. */
export function currentMatch(matches: readonly SpeedSearchMatch[], selected: number): number | null {
  if (matches.some((found) => found.index === selected)) return selected;
  return stepMatch(matches, selected, 1);
}

/** Whether a key press should open speed search over the tree: one printable character, no modifier. */
export function startsSpeedSearch(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): boolean {
  return event.key.length === 1 && event.key.trim() !== "" && !event.metaKey && !event.ctrlKey && !event.altKey;
}
