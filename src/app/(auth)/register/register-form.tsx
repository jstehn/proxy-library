"use client";
import { useActionState } from "react";
import { Alert, SubmitButton, TextField } from "@/ui/form";
import { registerAction, type RegisterState } from "./actions";

type RegisterFormProps = {
  needsInvite: boolean; // false only for the very first player
  inviteCode: string; // pre-filled from a shared link (?invite=...)
  passwordMinLength: number;
};

export function RegisterForm(props: RegisterFormProps) {
  const initialState: RegisterState = {
    error: null,
    values: { username: "", displayName: "", inviteCode: props.inviteCode },
  };
  const [state, formAction] = useActionState(registerAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {props.needsInvite && (
        <TextField
          label="Invite code"
          name="inviteCode"
          defaultValue={state.values.inviteCode}
          hint="Looks like K7QM-2XPA-9TRD. Ask an admin for one."
        />
      )}
      <TextField
        label="Username"
        name="username"
        defaultValue={state.values.username}
        autoComplete="username"
        hint="3–20 characters: letters, numbers, _ and -. You sign in with this."
      />
      <TextField
        label="Display name"
        name="displayName"
        defaultValue={state.values.displayName}
        autoComplete="nickname"
        hint="What other players see."
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${props.passwordMinLength} characters.`}
      />
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <SubmitButton pendingText="Creating your account…">Create account</SubmitButton>
    </form>
  );
}
