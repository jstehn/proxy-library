"use client";
import { useActionState } from "react";
import { Alert, SubmitButton } from "@/ui/form";
import { resetLibraryAction, type ResetActionState } from "./reset-actions";

const initialState: ResetActionState = { message: null, tone: "success" };

/**
 * Empties a player's library. Hidden behind "Reset library…" and a typed confirmation, because
 * it can't be undone.
 */
export function ResetForm(props: { userId: string; username: string }) {
  const [state, formAction] = useActionState(resetLibraryAction, initialState);

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">Reset library…</summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <p className="text-zinc-600 dark:text-zinc-400">
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
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
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
