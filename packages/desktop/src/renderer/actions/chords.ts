/**
 * Keyboard chords in one platform-neutral spelling: `"Mod+Shift+A"`, `"Mod+Enter"`, `"Escape"`, and
 * `"Shift Shift"` for a double-tap. `Mod` is `⌘` on macOS and `Ctrl` elsewhere (decision 015).
 */

export type Platform = "mac" | "other";

/** A chord as declared on an action, e.g. `"Mod+Shift+A"`. */
export type Chord = string;

export type Modifier = "Mod" | "Ctrl" | "Alt" | "Shift";

/** One key with the modifiers held, resolved for a platform. */
export interface Stroke {
  readonly kind: "stroke";
  readonly key: string;
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/** The same modifier pressed and released twice, with nothing between. */
export interface DoubleTap {
  readonly kind: "doubleTap";
  readonly modifier: Exclude<Modifier, "Mod">;
}

export type ParsedChord = Stroke | DoubleTap;

/** The fields of a `KeyboardEvent` that chord matching reads. */
export interface KeyLike {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const MODIFIERS: readonly Modifier[] = ["Mod", "Ctrl", "Alt", "Shift"];
const DOUBLE_TAP_SEPARATOR = " ";
const STROKE_SEPARATOR = "+";

/** `KeyboardEvent.code` names whose key is the character they print unshifted on a US layout. */
const CODE_KEYS: Readonly<Record<string, string>> = {
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  NumpadEnter: "Enter",
};
const LETTER_CODE_PREFIX = "Key";
const DIGIT_CODE_PREFIX = "Digit";

const MAC_GLYPHS: Readonly<Record<string, string>> = {
  Enter: "↩",
  Escape: "⎋",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};
const MAC_MODIFIER_GLYPHS = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" } as const;
const MAC_DOUBLE_TAP_GLYPHS: Readonly<Record<DoubleTap["modifier"], string>> = {
  Ctrl: "⌃⌃",
  Alt: "⌥⌥",
  Shift: "⇧⇧",
};
const OTHER_KEY_NAMES: Readonly<Record<string, string>> = { Escape: "Esc" };

function isModifier(part: string): part is Modifier {
  return (MODIFIERS as readonly string[]).includes(part);
}

/** Parses a declared chord for `platform`; throws on a spelling no action should ship with. */
export function parseChord(chord: Chord, platform: Platform): ParsedChord {
  const taps = chord.split(DOUBLE_TAP_SEPARATOR);
  if (taps.length === 2) {
    const [first, second] = taps;
    if (first !== second || first === undefined || !isModifier(first) || first === "Mod") {
      throw new Error(`Chord "${chord}" is not a double-tap of Ctrl, Alt or Shift.`);
    }
    return { kind: "doubleTap", modifier: first };
  }
  const parts = chord.split(STROKE_SEPARATOR);
  const key = parts.pop();
  if (key === undefined || key === "" || isModifier(key) || !parts.every(isModifier)) {
    throw new Error(`Chord "${chord}" must be modifiers joined by "+" and then one key, like "Mod+Shift+A".`);
  }
  const has = (modifier: Modifier) => parts.includes(modifier);
  const mod = has("Mod");
  return {
    kind: "stroke",
    key: key.length === 1 ? key.toUpperCase() : key,
    meta: mod && platform === "mac",
    ctrl: has("Ctrl") || (mod && platform === "other"),
    alt: has("Alt"),
    shift: has("Shift"),
  };
}

/** The physical key an event is for, in a chord's spelling. Physical, so `Shift+]` stays `]`. */
export function keyOf(event: Pick<KeyLike, "key" | "code">): string {
  const named = CODE_KEYS[event.code];
  if (named !== undefined) return named;
  if (event.code.startsWith(LETTER_CODE_PREFIX)) return event.code.slice(LETTER_CODE_PREFIX.length);
  if (event.code.startsWith(DIGIT_CODE_PREFIX)) return event.code.slice(DIGIT_CODE_PREFIX.length);
  if (event.code !== "") return event.code;
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

export function strokeOf(event: KeyLike): Stroke {
  return {
    kind: "stroke",
    key: keyOf(event),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}

/** A stable string for a parsed chord, so two declarations of the same keys compare equal. */
export function chordKey(chord: ParsedChord): string {
  if (chord.kind === "doubleTap") return `${chord.modifier}${DOUBLE_TAP_SEPARATOR}${chord.modifier}`;
  const held = [chord.ctrl && "ctrl", chord.alt && "alt", chord.shift && "shift", chord.meta && "meta"].filter(Boolean);
  return [...held, chord.key].join(STROKE_SEPARATOR);
}

export function matches(chord: ParsedChord, event: KeyLike): boolean {
  return chord.kind === "stroke" && chordKey(chord) === chordKey(strokeOf(event));
}

/** How a chord reads in menus and the palette: `⇧⌘A` on macOS, `Ctrl+Shift+A` elsewhere. */
export function formatChord(chord: Chord, platform: Platform): string {
  const parsed = parseChord(chord, platform);
  if (platform === "mac") {
    if (parsed.kind === "doubleTap") return MAC_DOUBLE_TAP_GLYPHS[parsed.modifier];
    const held = (["ctrl", "alt", "shift", "meta"] as const).filter((name) => parsed[name]);
    return held.map((name) => MAC_MODIFIER_GLYPHS[name]).join("") + (MAC_GLYPHS[parsed.key] ?? parsed.key);
  }
  if (parsed.kind === "doubleTap") return `Double ${parsed.modifier}`;
  const held = [parsed.ctrl && "Ctrl", parsed.alt && "Alt", parsed.shift && "Shift"].filter(Boolean);
  return [...held, OTHER_KEY_NAMES[parsed.key] ?? parsed.key].join(STROKE_SEPARATOR);
}

/** DataGrip's double-Shift window; slower presses read as two separate Shifts. */
export const DOUBLE_TAP_WINDOW_MS = 300;

const TAP_MODIFIERS: Readonly<Record<string, DoubleTap["modifier"]>> = {
  Shift: "Shift",
  Control: "Ctrl",
  Alt: "Alt",
};

export interface TimedKey extends KeyLike {
  readonly repeat: boolean;
  /** Milliseconds, as `KeyboardEvent.timeStamp`. */
  readonly timeStamp: number;
}

export interface DoubleTapDetector {
  /** Feeds every keydown; answers the modifier when this one completes a double-tap. */
  feed(event: TimedKey): DoubleTap["modifier"] | null;
  reset(): void;
}

export function createDoubleTapDetector(windowMs: number = DOUBLE_TAP_WINDOW_MS): DoubleTapDetector {
  let last: { readonly modifier: DoubleTap["modifier"]; readonly at: number } | null = null;
  return {
    feed(event) {
      const modifier = TAP_MODIFIERS[event.key];
      const heldModifiers = [event.shiftKey, event.ctrlKey, event.altKey, event.metaKey].filter(Boolean).length;
      if (modifier === undefined || heldModifiers > 1) {
        last = null;
        return null;
      }
      if (event.repeat) return null;
      if (last !== null && last.modifier === modifier && event.timeStamp - last.at <= windowMs) {
        last = null;
        return modifier;
      }
      last = { modifier, at: event.timeStamp };
      return null;
    },
    reset() {
      last = null;
    },
  };
}

/** The platform this renderer runs on; a function so tests never depend on the machine. */
export function currentPlatform(): Platform {
  return /Mac/i.test(navigator.platform) ? "mac" : "other";
}
