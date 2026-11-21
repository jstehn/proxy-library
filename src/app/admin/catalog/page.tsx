import { type SyncRunRow } from "@/modules/catalog";
import { LocalTime } from "@/ui/local-time";
import { EnableStandardButton, RefreshWhileSyncing, SetsTable, SyncButtons } from "./controls";
import { readPage } from "@/server/page-instance";

export default async function AdminCatalogPage() {
  const { actor: admin, reads } = await readPage({ admin: true });

  const [runs, sets] = await Promise.all([
    reads.catalog.recentSyncRuns(admin),
    reads.catalog.listSetsForAdmin(admin),
  ]);
  const isSyncing = runs.some((run) => run.status === "queued" || run.status === "running");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12">
      <RefreshWhileSyncing isSyncing={isSyncing} />
      <h1 className="text-2xl font-semibold">Catalog</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Data sync</h2>
        <p className="text-muted text-sm">
          Prices are refreshed every night by the worker (<code>pnpm worker schedule</code>). A full
          sync also re-imports sets whose MTGJSON data changed.
        </p>
        <SyncButtons />
        <SyncRunsList runs={runs} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Sets</h2>
        <p className="text-muted text-sm">
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
  if (props.runs.length === 0) return <p className="text-muted text-sm">No syncs yet.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {props.runs.map((run) => {
        const summary = run.summary ?? {};
        const count = (key: string) =>
          Array.isArray(summary[key]) ? (summary[key] as unknown[]).length : 0;
        return (
          <li key={run.id} className="border-border-subtle rounded-md border px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">
                #{run.id} {run.kind}
              </span>
              <StatusBadge status={run.status} />
              <span className="text-muted">
                requested <LocalTime iso={run.requestedAt} withTime />
              </span>
              {run.startedAt && run.finishedAt && (
                <span className="text-muted">
                  took {Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)}
                  s
                </span>
              )}
            </div>
            {run.summary && (
              <p className="text-muted mt-1">
                {count("importedSets")} sets imported · {String(summary.pricedPrintings ?? 0)} cards
                priced · {count("leftOut")} items left out
              </p>
            )}
            {run.error && <p className="text-danger-text mt-1">{run.error}</p>}
            {run.summary && (
              <details className="mt-1">
                <summary className="text-muted cursor-pointer">Details</summary>
                <pre className="bg-surface mt-2 max-h-80 overflow-auto rounded p-2 text-xs">
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
    queued: "bg-surface-raised text-foreground",
    running: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
    succeeded: "bg-green-100 text-success-ink dark:bg-green-950",
    failed: "bg-red-100 text-danger-ink dark:bg-red-950",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${colors[props.status] ?? ""}`}>
      {props.status}
    </span>
  );
}
