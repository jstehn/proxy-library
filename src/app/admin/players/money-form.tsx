"use client";
import { useActionState } from "react";
import { Alert } from "@/ui/form";
import { moneyAction } from "./money-actions";
import type { FormState } from "@/server/form-action";
import { Button } from "@/ui/button";

const initialState: FormState = { message: null, tone: null };

const inputClass = "rounded-md border border-line bg-field px-2 py-1 text-sm";

/** Give or take money from one player. Both buttons submit the same form with a different intent. */
export function MoneyForm(props: { userId: string; username: string }) {
  const [state, formAction] = useActionState(moneyAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="userId" value={props.userId} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="amount"
          aria-label={`Amount for @${props.username}`}
          placeholder="Amount, e.g. 25.00"
          required
          className={`w-36 ${inputClass}`}
        />
        <input
          name="note"
          aria-label={`Note for @${props.username}`}
          placeholder="Why? (required)"
          required
          className={`min-w-40 flex-1 ${inputClass}`}
        />
        <IntentButton intent="give" label="Give" />
        <IntentButton intent="take" label="Take away" />
      </div>
      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
    </form>
  );
}

/**
 * A submit button that also sends which action it stands for: the clicked button's name/value
 * pair is included in the form data, so one form can have "Give" and "Take away" buttons.
 */
function IntentButton(props: { intent: "give" | "take"; label: string }) {
  return (
    <Button type="submit" name="intent" value={props.intent} variant="secondary" size="sm">
      {props.label}
    </Button>
  );
}
