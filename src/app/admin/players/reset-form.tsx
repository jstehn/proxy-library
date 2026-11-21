"use client";
import { useActionState } from "react";
import { Alert, SubmitButton } from "@/ui/form";
import { resetLibraryAction } from "./reset-actions";
import type { FormState } from "@/server/form-action";

const initialState: FormState = { message: null, tone: null };

/**
 * Empties a player's library. Hidden behind "Reset library…" and a typed confirmation, because
 * it can't be undone.
 */
export function ResetForm(props: { userId: string; username: string }) {
  const [state, formAction] = useActionState(resetLibraryAction, initialState);

  return (
    <details className="text-sm">
      <summary className="text-muted cursor-pointer">Reset library…</summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <p className="text-muted">
          Removes every card, sealed item and deck @{props.username} has, closes their open trades,
          and sets their balance back to the starting grant. Their money and card history keep a
          record. This can&apos;t be undone.
        </p>
        <input type="hidden" name="userId" value={props.userId} />
        <input type="hidden" name="username" value={props.username} />
        <div className="flex flex-wrap items-center gap-2">
          <input
            name="confirmation"
            aria-label={`Type ${props.username} to confirm`}
            placeholder={`Type ${props.username} to confirm`}
            autoComplete="off"
            required
            className="border-line bg-field rounded-md border px-2 py-1"
          />
          <SubmitButton tone="danger" pendingText="Resetting…">
            Reset library
          </SubmitButton>
        </div>
        {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
      </form>
    </details>
  );
}
