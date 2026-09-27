"use client";
import { useActionState } from "react";
import { Alert, SubmitButton, TextField } from "@/ui/form";
import { signInAction, type SignInState } from "./actions";

const initialState: SignInState = { error: null, username: "" };

export function SignInForm() {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <TextField
        label="Username"
        name="username"
        defaultValue={state.username}
        autoComplete="username"
      />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" />
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
