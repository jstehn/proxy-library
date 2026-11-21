"use client";
import { useActionState } from "react";
import type { FormState } from "@/server/form-action";
import { Alert, SubmitButton } from "@/ui/form";
import { setPlayerEmailAction } from "./email-actions";

const initialState: FormState = { message: null, tone: null };

/**
 * A player's real email. Setting it vouches for it: when their Authentik account has the same
 * email, the first Authentik sign-in links to this player. Leave it empty to clear it.
 */
export function EmailForm(props: { userId: string; email: string | null }) {
  const [state, formAction] = useActionState(setPlayerEmailAction, initialState);

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
        Email{props.email === null ? "" : `: ${props.email}`}…
      </summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <p className="text-zinc-600 dark:text-zinc-400">
          Only set an email you know belongs to this player. It is treated as verified, and it lets
          an Authentik account with the same email sign in as them.
        </p>
        <input type="hidden" name="userId" value={props.userId} />
        <div className="flex flex-wrap items-center gap-2">
          <input
            name="email"
            type="email"
            aria-label="Email"
            defaultValue={props.email ?? ""}
            autoComplete="off"
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <SubmitButton tone="secondary" pendingText="Saving…">
            Save email
          </SubmitButton>
        </div>
        {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
      </form>
    </details>
  );
}
