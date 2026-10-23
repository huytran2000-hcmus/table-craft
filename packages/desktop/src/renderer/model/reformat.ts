const BLANK = /\s/;

function isBlank(text: string, index: number): boolean {
  return BLANK.test(text.charAt(index));
}

/**
 * Where the caret goes once `before` is reformatted into `after` (plan 019 decision 2): the same
 * number of non-blank characters precede it, so it stays on its token whatever the formatter did
 * to the whitespace. A caret in whitespace goes right before the next token, as the new
 * whitespace around it is the formatter's. Keyword case may change, the count of non-blank
 * characters does not.
 */
export function caretAfterReformat(before: string, after: string, caret: number): number {
  const end = Math.min(caret, before.length);
  let solid = 0;
  for (let index = 0; index < end; index++) if (!isBlank(before, index)) solid++;
  const inBlank = end > 0 && isBlank(before, end - 1);
  let seen = 0;
  for (let index = 0; index < after.length; index++) {
    if (isBlank(after, index)) continue;
    if (inBlank && seen === solid) return index;
    seen++;
    if (!inBlank && seen === solid) return index + 1;
  }
  return solid === 0 ? 0 : after.length;
}
