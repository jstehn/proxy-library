"use client";
import { useActionState } from "react";
import { Alert, SubmitButton, TextField } from "@/ui/form";
import type { FormState } from "@/server/form-action";
import { addFundsAction } from "./actions";

const initialState: FormState = { message: null, tone: null };

export function AddFundsForm(props: { limitText: string }) {
  const [state, formAction] = useActionState(addFundsAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <TextField label="Amount" name="amount" hint={`Up to ${props.limitText} at a time.`} />
      <TextField label="Note (optional)" name="note" required={false} />
      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
      <div>
        <SubmitButton pendingText="Adding…">Add funds</SubmitButton>
      </div>
    </form>
  );
}
