"use client";
import { useActionState } from "react";
import { Alert, SubmitButton } from "@/ui/form";
import { startOverAction, type StartOverState } from "./actions";
import { CONFIRMATION_WORD } from "./confirmation";

const initialState: StartOverState = { message: null, tone: "success" };

/** Resets the player's own account, behind a typed confirmation (it can't be undone). */
export function StartOverForm() {
  const [state, formAction] = useActionState(startOverAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="confirmation"
          aria-label={`Type ${CONFIRMATION_WORD} to confirm`}
          placeholder={CONFIRMATION_WORD}
          autoComplete="off"
          required
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <SubmitButton tone="danger" pendingText="Starting over…">
          Start over
        </SubmitButton>
      </div>
      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
    </form>
  );
}
