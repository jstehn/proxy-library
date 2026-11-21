"use client";
// Small form building blocks shared by every page. Client components, because the submit
// button shows a "working…" state while its form's server action runs.
import { useFormStatus } from "react-dom";

type TextFieldProps = {
  label: string;
  name: string;
  type?: "text" | "password";
  defaultValue?: string;
  autoComplete?: string;
  hint?: string;
  required?: boolean;
};

export function TextField(props: TextFieldProps) {
  const { label, name, type = "text", defaultValue, autoComplete, hint, required = true } = props;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        required={required}
        className="border-line bg-field rounded-md border px-3 py-2 text-base"
      />
      {hint && <span className="text-muted text-xs">{hint}</span>}
    </label>
  );
}

type SubmitButtonProps = {
  children: React.ReactNode;
  pendingText?: string;
  tone?: "primary" | "secondary" | "danger";
};

const TONES = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  secondary: "border border-line bg-field hover:bg-surface",
  danger: "bg-red-700 text-white hover:bg-red-600",
};

/** A submit button that disables itself while its form is being submitted. */
export function SubmitButton(props: SubmitButtonProps) {
  const { children, pendingText = "Working…", tone = "primary" } = props;
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60 ${TONES[tone]}`}
    >
      {pending ? pendingText : children}
    </button>
  );
}

type AlertProps = { tone: "error" | "success"; children: React.ReactNode };

export function Alert(props: AlertProps) {
  const colors =
    props.tone === "error"
      ? "border-danger-line bg-danger-soft text-danger-ink"
      : "border-success-line bg-success-soft text-success-ink";
  return (
    <p role="status" aria-live="polite" className={`rounded-md border px-3 py-2 text-sm ${colors}`}>
      {props.children}
    </p>
  );
}
