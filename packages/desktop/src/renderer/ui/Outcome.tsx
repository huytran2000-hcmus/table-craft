import type { ExecutionOutcome } from "@table-craft/desktop/renderer/state/executions.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import { CancelledIcon, ErrorIcon, SpinnerIcon, SuccessIcon } from "@table-craft/desktop/renderer/ui/icons.js";

/** One colour per outcome (design-system: outcome glyphs), shared by Query History and Services. */
const OUTCOME_TEXT: Readonly<Record<ExecutionOutcome, string>> = {
  running: "text-accent",
  success: "text-success",
  error: "text-danger",
  cancelled: "text-warning",
};

const OUTCOME_DOT: Readonly<Record<Exclude<ExecutionOutcome, "running">, string>> = {
  success: "bg-success",
  error: "bg-danger",
  cancelled: "bg-warning",
};

/** A history entry's last outcome: a dot, its word for screen readers. */
export function OutcomeDot({ outcome }: { readonly outcome: Exclude<ExecutionOutcome, "running"> }) {
  return (
    <span
      role="img"
      aria-label={outcome}
      data-outcome={outcome}
      className={cn("size-2 shrink-0 rounded-full", OUTCOME_DOT[outcome])}
    />
  );
}

const OUTCOME_GLYPH = {
  running: SpinnerIcon,
  success: SuccessIcon,
  error: ErrorIcon,
  cancelled: CancelledIcon,
} as const;

/** An execution's outcome in Services; the running one spins. */
export function OutcomeGlyph({ outcome }: { readonly outcome: ExecutionOutcome }) {
  const Glyph = OUTCOME_GLYPH[outcome];
  return (
    <Glyph
      role="img"
      aria-label={outcome}
      data-outcome={outcome}
      className={cn("size-icon shrink-0", OUTCOME_TEXT[outcome], outcome === "running" && "animate-spin")}
    />
  );
}
