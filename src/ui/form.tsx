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
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
      />
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

type SubmitButtonProps = {
  children: React.ReactNode;
  pendingText?: string;
  tone?: "primary" | "secondary" | "danger";
};

const TONES = {
  primary: "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900",
  secondary:
    "border border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900",
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
      ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
      : "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100";
  return (
    <p role="status" aria-live="polite" className={`rounded-md border px-3 py-2 text-sm ${colors}`}>
      {props.children}
    </p>
  );
}
