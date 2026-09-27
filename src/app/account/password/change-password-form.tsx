"use client";
import { useActionState } from "react";
import { Alert, SubmitButton, TextField } from "@/ui/form";
import { changePasswordAction, type ChangePasswordState } from "./actions";

const initialState: ChangePasswordState = { error: null, success: false };

export function ChangePasswordForm(props: { passwordMinLength: number }) {
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <TextField
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
      />
      <TextField
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        hint={`At least ${props.passwordMinLength} characters.`}
      />
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.success && <Alert tone="success">Your password has been changed.</Alert>}
      <SubmitButton pendingText="Saving…">Change password</SubmitButton>
    </form>
  );
}
