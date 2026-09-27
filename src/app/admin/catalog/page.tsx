import { listSetsForAdmin, recentSyncRuns, type SyncRunRow } from "@/modules/catalog";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { LocalTime } from "@/ui/local-time";
import { EnableStandardButton, RefreshWhileSyncing, SetsTable, SyncButtons } from "./controls";

export default async function AdminCatalogPage() {
  await requireAdminActor();
  const { db } = getContainer();
  const [runs, sets] = await Promise.all([recentSyncRuns(db), listSetsForAdmin(db)]);
  const isSyncing = runs.some((run) => run.status === "queued" || run.status === "running");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12">
      <RefreshWhileSyncing isSyncing={isSyncing} />
      <h1 className="text-2xl font-semibold">Catalog</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Data sync</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Prices are refreshed every night by the worker (<code>pnpm worker schedule</code>). A full
          sync also re-imports sets whose MTGJSON data changed.
        </p>
        <SyncButtons />
        <SyncRunsList runs={runs} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Sets</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Players can buy product from enabled sets. Sets marked &quot;supporting&quot; were
          imported only for cards that enabled sets&apos; boosters and products use.
        </p>
        <EnableStandardButton />
        <SetsTable sets={sets} />
      </section>
    </main>
  );
}

function SyncRunsList(props: { runs: SyncRunRow[] }) {
  if (props.runs.length === 0) return <p className="text-sm text-zinc-500">No syncs yet.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {props.runs.map((run) => {
        const summary = run.summary ?? {};
        const count = (key: string) =>
          Array.isArray(summary[key]) ? (summary[key] as unknown[]).length : 0;
        return (
          <li
            key={run.id}
            className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">
                #{run.id} {run.kind}
              </span>
              <StatusBadge status={run.status} />
              <span className="text-zinc-500">
                requested <LocalTime iso={run.requestedAt} withTime />
              </span>
              {run.startedAt && run.finishedAt && (
                <span className="text-zinc-500">
                  took {Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)}
                  s
                </span>
              )}
            </div>
            {run.summary && (
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                {count("importedSets")} sets imported · {String(summary.pricedPrintings ?? 0)} cards
                priced · {count("leftOut")} items left out
              </p>
            )}
            {run.error && <p className="mt-1 text-red-700 dark:text-red-400">{run.error}</p>}
            {run.summary && (
              <details className="mt-1">
                <summary className="cursor-pointer text-zinc-500">Details</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                  {JSON.stringify(run.summary, null, 2)}
                </pre>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatusBadge(props: { status: string }) {
  const colors: Record<string, string> = {
    queued: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100",
    running: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
    succeeded: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100",
    failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${colors[props.status] ?? ""}`}>
      {props.status}
    </span>
  );
}
