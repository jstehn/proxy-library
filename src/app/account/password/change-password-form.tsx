"use client";
import { useActionState } from "react";
import type { FormState } from "@/server/form-action";
import { Alert, SubmitButton, TextField } from "@/ui/form";
import { changePasswordAction } from "./actions";

const initialState: FormState = { message: null, tone: null };

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
      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
      <SubmitButton pendingText="Saving…">Change password</SubmitButton>
    </form>
  );
}
