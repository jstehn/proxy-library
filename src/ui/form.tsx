"use client";
// Small form building blocks shared by every page. Client components, because the submit
// button shows a "working…" state while its form's server action runs.
import { useFormStatus } from "react-dom";
import { Button } from "./button";
import { Input } from "./field";

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
      <Input
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        required={required}
        controlSize="form"
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

/** A submit button that disables itself while its form is being submitted. */
export function SubmitButton(props: SubmitButtonProps) {
  const { children, pendingText = "Working…", tone = "primary" } = props;
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={tone} size="lg" disabled={pending}>
      {pending ? pendingText : children}
    </Button>
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
