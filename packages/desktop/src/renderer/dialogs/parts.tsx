import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";

export const OVERLAY_CLASS = "fixed inset-0 z-40 bg-canvas/60";
export const CONTENT_CLASS =
  "fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-panel text-ui text-ink shadow-2xl outline-none";
export const INPUT_CLASS =
  "h-row min-w-0 rounded border border-line bg-canvas px-cell text-ink outline-none focus:border-accent disabled:opacity-60";

type ButtonVariant = "primary" | "secondary" | "danger";

const BUTTON_CLASS: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-accent text-accent-ink",
  secondary: "border border-line text-ink hover:bg-raised",
  danger: "bg-danger text-accent-ink",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={cn("h-row shrink-0 rounded px-gap disabled:opacity-50", BUTTON_CLASS[variant], className)}
      {...props}
    />
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(INPUT_CLASS, className)} spellCheck={false} {...props} />;
}

/** A label column and its control, in the dialog's two-column grid. */
export function FieldRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <>
      <label htmlFor={htmlFor} className="flex h-row items-center justify-end text-ink-muted">
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-cell">{children}</div>
    </>
  );
}
