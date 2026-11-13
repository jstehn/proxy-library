import Link from "next/link";
import { sharedRealCollections } from "@/modules/real-collection";
import { tradesFor, type TradeView } from "@/modules/trades";
import { sharedWishlists } from "@/modules/wishlist";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { LocalTime } from "@/ui/local-time";
import { itemText, STATUS_LABELS } from "./summary";

function TradeLine(props: {
  trade: TradeView;
  sharingReal: ReadonlySet<string>;
  sharingWishlist: ReadonlySet<string>;
}) {
  const { trade } = props;
  const other = trade.yourSide === "proposer" ? trade.recipient : trade.proposer;
  const yours = trade.items.filter((item) => item.from === trade.yourSide);
  const theirs = trade.items.filter((item) => item.from !== trade.yourSide);
  return (
    <li className="flex flex-col gap-0.5 py-3">
      <Link href={`/trades/${trade.id}`} className="font-medium underline">
        {trade.yourSide === "proposer" ? `To ${other.displayName}` : `From ${other.displayName}`}
      </Link>
      {(props.sharingReal.has(other.userId) || props.sharingWishlist.has(other.userId)) && (
        <span className="text-muted flex flex-wrap gap-2 text-xs">
          {props.sharingReal.has(other.userId) && (
            <Link href={`/players/${other.userId}/real`} className="underline">
              {other.displayName}&apos;s real collection
            </Link>
          )}
          {props.sharingWishlist.has(other.userId) && (
            <Link href={`/players/${other.userId}/wishlist`} className="underline">
              {other.displayName}&apos;s wishlist
            </Link>
          )}
        </span>
      )}
      <span className="text-sm">
        You give: {yours.map(itemText).join(", ") || "nothing"} · You get:{" "}
        {theirs.map(itemText).join(", ") || "nothing"}
      </span>
      <span className="text-muted text-xs">
        {STATUS_LABELS[trade.status]} ·{" "}
        <LocalTime iso={trade.decidedAt ?? trade.createdAt} withTime />
      </span>
    </li>
  );
}

export default async function TradesPage() {
  const actor = await requireActor();
  const { db } = getContainer();
  const [trades, shared, sharedWishes] = await Promise.all([
    tradesFor(db, actor.userId),
    sharedRealCollections(db),
    sharedWishlists(db),
  ]);
  // Players who share their real collection or wishlist get a link next to their name.
  const sharingReal = new Set(shared.map((player) => player.userId));
  const sharingWishlist = new Set(sharedWishes.map((player) => player.userId));
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
        <p className="text-muted text-sm">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {list.map((trade) => (
            <TradeLine
              key={trade.id}
              trade={trade}
              sharingReal={sharingReal}
              sharingWishlist={sharingWishlist}
            />
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
