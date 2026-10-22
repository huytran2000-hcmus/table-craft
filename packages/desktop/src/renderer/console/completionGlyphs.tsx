import type { Completion } from "@codemirror/autocomplete";
import type { Icon } from "@phosphor-icons/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CompletionKind } from "@table-craft/desktop/engine/protocol.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import {
  AliasIcon,
  ColumnIcon,
  CteIcon,
  JoinIcon,
  KeywordIcon,
  RoutineIcon,
  SchemaIcon,
  TableIcon,
  ViewIcon,
} from "@table-craft/desktop/renderer/ui/icons.js";

export const COMPLETION_GLYPH_CLASS = "cm-tc-glyph";

/** The Database pane's glyph and tone for what the tree also shows; the rest get their own. */
const GLYPHS: Readonly<Record<CompletionKind, { readonly glyph: Icon; readonly tone: string }>> = {
  namespace: { glyph: SchemaIcon, tone: "text-ink-muted" },
  table: { glyph: TableIcon, tone: "text-accent" },
  view: { glyph: ViewIcon, tone: "text-accent" },
  column: { glyph: ColumnIcon, tone: "text-ink-muted" },
  alias: { glyph: AliasIcon, tone: "text-ink-muted" },
  cte: { glyph: CteIcon, tone: "text-accent" },
  join: { glyph: JoinIcon, tone: "text-accent" },
  function: { glyph: RoutineIcon, tone: "text-ink-muted" },
  keyword: { glyph: KeywordIcon, tone: "text-ink-muted" },
};

const markup = new Map<string, string | null>();

function isKind(kind: string): kind is CompletionKind {
  return Object.hasOwn(GLYPHS, kind);
}

/** The SVG for `kind`, rendered once; null for a kind the engine does not send. */
export function completionGlyphMarkup(kind: string): string | null {
  const cached = markup.get(kind);
  if (cached !== undefined) return cached;
  let html: string | null = null;
  if (isKind(kind)) {
    const { glyph: Glyph, tone } = GLYPHS[kind];
    html = renderToStaticMarkup(<Glyph aria-hidden className={cn("size-icon shrink-0", tone)} />);
  }
  markup.set(kind, html);
  return html;
}

/** CodeMirror's `addToOptions` renderer: the option's glyph, keyed by its `type`. */
export function renderCompletionGlyph(completion: Completion): Node | null {
  const html = completionGlyphMarkup(completion.type ?? "");
  if (html === null) return null;
  const span = document.createElement("span");
  span.className = COMPLETION_GLYPH_CLASS;
  span.innerHTML = html;
  return span;
}
