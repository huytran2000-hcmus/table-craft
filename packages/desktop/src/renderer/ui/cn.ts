export type ClassValue = string | false | null | undefined;

/** Joins the truthy class names; components own their classes outright, so nothing needs merging. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
