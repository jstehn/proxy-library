import { currentEconomySettings, nextPayday, walletHistory, walletSummary } from "@/modules/wallet";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { LocalTime } from "@/ui/local-time";
import { AddFundsForm } from "./add-funds-form";
import { ledgerKindLabel } from "./labels";

export default async function WalletPage() {
  const actor = await requireActor();
  const { wallet, db, clock } = getContainer();

  // Pay anything that's due first, so the page shows an up-to-date balance.
  await wallet.refreshWallet(actor.userId);
  const [summary, history, settings] = await Promise.all([
    walletSummary(db, actor.userId),
    walletHistory(db, actor.userId),
    currentEconomySettings(db),
  ]);
  const payday = nextPayday(
    { anchor: settings.allowanceAnchor, periodDays: settings.allowancePeriodDays },
    clock.now(),
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Wallet</h1>
        <p className="text-4xl font-semibold tabular-nums">{Cents.format(summary.balance)}</p>
        {settings.allowance > 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Next allowance: {Cents.format(settings.allowance)} on{" "}
            <LocalTime iso={payday.toISOString()} withTime />
          </p>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Received" value={summary.received} />
        <Stat label="Self-funded" value={summary.selfFunded} />
        <Stat label="Spent" value={summary.spent} />
        <Stat label="Corrected" value={summary.corrected} />
      </dl>

      {actor.canSelfFund && (
        <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Add your own funds</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Money you add is recorded as self-funded, which admins can see.
          </p>
          <AddFundsForm limitText={Cents.format(settings.selfFundLimit)} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">History</h2>
        {history.length === 0 && <p className="text-sm text-zinc-500">Nothing yet.</p>}
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {history.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
            >
              <span className="w-32 text-zinc-500">
                <LocalTime iso={entry.effectiveAt} />
              </span>
              <span className="flex-1">
                {ledgerKindLabel(entry.kind)}
                {entry.note && <span className="text-zinc-500"> · {entry.note}</span>}
                {entry.createdByUsername && entry.createdByUsername !== actor.username && (
                  <span className="text-zinc-500"> · by @{entry.createdByUsername}</span>
                )}
              </span>
              <span
                className={`tabular-nums ${entry.amount < 0 ? "text-red-700 dark:text-red-400" : ""}`}
              >
                {entry.amount > 0 ? "+" : ""}
                {Cents.format(entry.amount)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Stat(props: { label: string; value: Cents }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <dt className="text-xs text-zinc-500">{props.label}</dt>
      <dd className="text-lg font-medium tabular-nums">{Cents.format(props.value)}</dd>
    </div>
  );
}
