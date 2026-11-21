"use client";
import { useActionState } from "react";
import { Alert, SubmitButton } from "@/ui/form";
import { createInviteAction, type CreateInviteState } from "./actions";

const initialState: CreateInviteState = { error: null, created: null };

type CreateInviteFormProps = { defaultDays: number; minDays: number; maxDays: number };

export function CreateInviteForm(props: CreateInviteFormProps) {
  const [state, formAction] = useActionState(createInviteAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        Valid for
        <input
          name="validForDays"
          type="number"
          min={props.minDays}
          max={props.maxDays}
          defaultValue={props.defaultDays}
          className="border-line bg-field w-20 rounded-md border px-2 py-1"
        />
        days
      </label>
      <div>
        <SubmitButton pendingText="Creating…">Create invite</SubmitButton>
      </div>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.created && (
        <Alert tone="success">
          New invite <code className="font-semibold">{state.created.code}</code>. Share this link:{" "}
          <code className="break-all">{state.created.link}</code>
        </Alert>
      )}
    </form>
  );
}
