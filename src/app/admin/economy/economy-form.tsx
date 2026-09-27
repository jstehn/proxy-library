"use client";
import { useActionState, useState, useSyncExternalStore } from "react";
import { Alert, SubmitButton, TextField } from "@/ui/form";
import { updateEconomyAction, type EconomyFormState } from "./actions";

const initialState: EconomyFormState = { message: null, tone: "success" };

export type EconomyFormValues = {
  allowance: string; // e.g. "20.00"
  allowancePeriodDays: number;
  anchorIso: string; // exact instant, e.g. "2026-09-21T00:00:00.000Z"
  startingGrant: string;
  selfFundLimit: string;
};

const noSubscription = () => () => {};
const useIsBrowser = () =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

/** "2026-09-21T09:00" in the viewer's own time zone, the format <input type="datetime-local"> wants. */
function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function EconomyForm(props: { values: EconomyFormValues; maxPeriodDays: number }) {
  const [state, formAction] = useActionState(updateEconomyAction, initialState);
  const [anchorIso, setAnchorIso] = useState(props.values.anchorIso);
  const isBrowser = useIsBrowser();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <TextField
        label="Allowance"
        name="allowance"
        defaultValue={props.values.allowance}
        hint="Paid every payday. 0 pauses allowances."
      />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Paid every (days)</span>
        <input
          name="allowancePeriodDays"
          type="number"
          min={1}
          max={props.maxPeriodDays}
          defaultValue={props.values.allowancePeriodDays}
          required
          className="w-24 rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">One payday, in your local time</span>
        {isBrowser ? (
          <input
            type="datetime-local"
            defaultValue={toLocalInputValue(new Date(props.values.anchorIso))}
            // The browser knows your time zone; turn the local time into an exact instant.
            onChange={(event) => setAnchorIso(new Date(event.target.value).toISOString())}
            required
            className="w-60 rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        ) : (
          <span className="text-zinc-500">Loading…</span>
        )}
        <span className="text-xs text-zinc-500">
          Every other payday is this one plus or minus a whole number of periods.
        </span>
      </label>
      <input type="hidden" name="anchorIso" value={anchorIso} />

      <TextField
        label="Starting grant"
        name="startingGrant"
        defaultValue={props.values.startingGrant}
        hint="Given once to each new player. 0 for none."
      />
      <TextField
        label="Self-funding limit"
        name="selfFundLimit"
        defaultValue={props.values.selfFundLimit}
        hint="The most a player may add to their own wallet at a time."
      />

      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
      <div>
        <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
      </div>
    </form>
  );
}
