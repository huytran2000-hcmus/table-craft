const INDENT = "  ";

/**
 * Re-indents JSON text without parsing it, so a bigint or a long decimal keeps every digit
 * (`JSON.parse` would round both). Text that is not JSON comes back reindented as far as it goes.
 */
export function prettyJson(text: string): string {
  let out = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  const newline = () => `\n${INDENT.repeat(depth)}`;
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === " " || char === "\t" || char === "\n" || char === "\r") continue;
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "{" || char === "[") {
      const close = char === "{" ? "}" : "]";
      const next = text
        .slice(index + 1)
        .trimStart()
        .charAt(0);
      if (next === close) {
        out += char + close;
        index = text.indexOf(close, index + 1);
        continue;
      }
      depth++;
      out += char + newline();
    } else if (char === "}" || char === "]") {
      depth = Math.max(depth - 1, 0);
      out += newline() + char;
    } else if (char === ",") {
      out += char + newline();
    } else if (char === ":") {
      out += ": ";
    } else {
      out += char;
    }
  }
  return out;
}
