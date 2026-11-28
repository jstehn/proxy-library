// Form controls with one look: `Input`, `Select`, `Textarea`, and `Field` (a label, the control,
// a hint and an error). Presentational only.
import type { ComponentProps, ReactNode } from "react";

export type ControlSize = "md" | "sm" | "xs" | "lg" | "form";

const SIZE_CLASSES: Record<ControlSize, string> = {
  md: "px-2 py-1.5 text-sm",
  sm: "px-2 py-1 text-sm",
  xs: "px-2 py-1.5 text-xs",
  lg: "px-3 py-2 text-sm",
  form: "px-3 py-2 text-base",
};

/** The class string for a text control, for the rare element that can't be one of these. */
export function controlClass(size: ControlSize = "md", className?: string): string {
  const classes = ["border-line bg-field rounded-control border", SIZE_CLASSES[size]];
  if (className) classes.push(className);
  return classes.join(" ");
}

type SizeProp = { controlSize?: ControlSize };

export function Input(props: ComponentProps<"input"> & SizeProp) {
  const { controlSize, className, ...rest } = props;
  return <input className={controlClass(controlSize, className)} {...rest} />;
}

export function Select(props: ComponentProps<"select"> & SizeProp) {
  const { controlSize, className, ...rest } = props;
  return <select className={controlClass(controlSize, className)} {...rest} />;
}

export function Textarea(props: ComponentProps<"textarea"> & SizeProp) {
  const { controlSize, className, ...rest } = props;
  return <textarea className={controlClass(controlSize, className)} {...rest} />;
}

type FieldProps = { label: string; hint?: string; error?: string; children: ReactNode };

/** A label above a control, with an optional hint and error beneath. */
export function Field(props: FieldProps) {
  const { label, hint, error, children } = props;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-muted text-xs">{hint}</span>}
      {error && <span className="text-danger-text text-xs">{error}</span>}
    </label>
  );
}
