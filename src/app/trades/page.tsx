import Link from "next/link";
import { tradesFor, type TradeView } from "@/modules/trades";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { LocalTime } from "@/ui/local-time";
import { itemText, STATUS_LABELS } from "./summary";

function TradeLine(props: { trade: TradeView }) {
  const { trade } = props;
  const other = trade.yourSide === "proposer" ? trade.recipient : trade.proposer;
  const yours = trade.items.filter((item) => item.from === trade.yourSide);
  const theirs = trade.items.filter((item) => item.from !== trade.yourSide);
  return (
    <li className="flex flex-col gap-0.5 py-3">
      <Link href={`/trades/${trade.id}`} className="font-medium underline">
        {trade.yourSide === "proposer" ? `To ${other.displayName}` : `From ${other.displayName}`}
      </Link>
      <span className="text-sm">
        You give: {yours.map(itemText).join(", ") || "nothing"} · You get:{" "}
        {theirs.map(itemText).join(", ") || "nothing"}
      </span>
      <span className="text-xs text-zinc-500">
        {STATUS_LABELS[trade.status]} ·{" "}
        <LocalTime iso={trade.decidedAt ?? trade.createdAt} withTime />
      </span>
    </li>
  );
}

export default async function TradesPage() {
  const actor = await requireActor();
  const trades = await tradesFor(getContainer().db, actor.userId);
  const forYou = trades.filter(
    (trade) => trade.status === "proposed" && trade.yourSide === "recipient",
  );
  const forThem = trades.filter(
    (trade) => trade.status === "proposed" && trade.yourSide === "proposer",
  );
  const history = trades.filter((trade) => trade.status !== "proposed");

  const section = (title: string, list: TradeView[], empty: string) => (
    <section className="flex flex-col gap-1">
      <h2 className="font-medium">{title}</h2>
      {list.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {list.map((trade) => (
            <TradeLine key={trade.id} trade={trade} />
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="flex-1 text-2xl font-semibold">Trades</h1>
        <Link
          href="/trades/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          New trade
        </Link>
      </header>
      {section("Waiting for you", forYou, "Nothing to decide.")}
      {section("Waiting for them", forThem, "No open offers.")}
      {section("History", history, "No trades yet.")}
    </main>
  );
}
