"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { AdminSetRow } from "@/modules/catalog";
import { Alert, SubmitButton } from "@/ui/form";
import {
  enableStandardSetsAction,
  requestSyncAction,
  setSetEnabledAction,
  type CatalogActionState,
} from "./actions";

const initialState: CatalogActionState = { message: null, tone: "success" };

export function SyncButtons() {
  const [state, formAction] = useActionState(requestSyncAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="kind"
          value="prices"
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Sync prices now
        </button>
        <button
          type="submit"
          name="kind"
          value="full"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Full sync now
        </button>
      </div>
      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
    </form>
  );
}

export function EnableStandardButton() {
  const [state, formAction] = useActionState(enableStandardSetsAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div>
        <SubmitButton tone="secondary" pendingText="Enabling…">
          Enable current Standard sets
        </SubmitButton>
      </div>
      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
    </form>
  );
}

/** While a sync is queued or running, reload the page's data every 5 seconds. */
export function RefreshWhileSyncing(props: { isSyncing: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!props.isSyncing) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [props.isSyncing, router]);
  return null;
}

/** Every known set, filterable, with an enable/disable switch each. */
export function SetsTable(props: { sets: AdminSetRow[] }) {
  const [filter, setFilter] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const query = filter.trim().toLowerCase();
  const shown = props.sets.filter(
    (set) =>
      (!enabledOnly || set.isEnabled) &&
      (query === "" || set.name.toLowerCase().includes(query) || set.code.toLowerCase() === query),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name or code"
          aria-label="Filter sets"
          className="w-64 rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabledOnly}
            onChange={(event) => setEnabledOnly(event.target.checked)}
          />
          Enabled only
        </label>
        <span className="text-zinc-500">{shown.length} sets</span>
      </div>
      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        {shown.map((set) => (
          <li key={set.code} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="w-14 font-mono text-xs">{set.code}</span>
            <span className="min-w-48 flex-1">{set.name}</span>
            <span className="w-24 text-zinc-500">{set.releaseDate}</span>
            <span className="w-28 text-zinc-500">{set.type}</span>
            <span className="flex w-40 gap-1 text-xs">
              {set.isStandard && <Tag>Standard</Tag>}
              {set.isSupporting && <Tag>supporting</Tag>}
              {set.printingCount > 0 && <Tag>{set.printingCount} cards</Tag>}
            </span>
            <form action={setSetEnabledAction}>
              <input type="hidden" name="code" value={set.code} />
              <input type="hidden" name="enabled" value={set.isEnabled ? "false" : "true"} />
              <SubmitButton tone={set.isEnabled ? "primary" : "secondary"} pendingText="…">
                {set.isEnabled ? "Enabled" : "Enable"}
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tag(props: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{props.children}</span>
  );
}
