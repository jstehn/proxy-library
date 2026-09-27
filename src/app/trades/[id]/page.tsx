import Link from "next/link";
import { notFound } from "next/navigation";
import { tradeView, type TradeItemView } from "@/modules/trades";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import { decideTradeAction } from "../actions";
import { draftHref, type DraftCard } from "../draft";
import { itemText, sideValue, STATUS_LABELS } from "../summary";

function Side(props: { title: string; items: readonly TradeItemView[] }) {
  return (
    <section className="flex flex-1 flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">{props.title}</h2>
      {props.items.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {props.items.map((item, index) => (
            <li key={index}>
              {item.kind === "card" && item.printingId ? (
                <Link href={`/cards/${item.printingId}`} className="hover:underline">
                  {itemText(item)}
                </Link>
              ) : (
                itemText(item)
              )}
              {item.kind === "card" && (
                <span className="text-xs text-zinc-500">
                  {" "}
                  {item.setCode} ·{" "}
                  {item.priceCents === null
                    ? "no price"
                    : `${Cents.format(Cents.of(item.priceCents))} each`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-zinc-500">
        About {Cents.format(sideValue(props.items))} at market price.
      </p>
    </section>
  );
}

const button = "rounded-md px-3 py-1.5 text-sm font-medium";

export default async function TradePage(props: PageProps<"/trades/[id]">) {
  const actor = await requireActor();
  const tradeId = Number((await props.params).id);
  const trade = Number.isSafeInteger(tradeId)
    ? await tradeView(getContainer().db, actor.userId, tradeId)
    : null;
  if (trade === null) notFound();
  const error = (await props.searchParams).error;
  const fromProposer = trade.items.filter((item) => item.from === "proposer");
  const fromRecipient = trade.items.filter((item) => item.from === "recipient");
  const isOpen = trade.status === "proposed";

  // A counter-offer starts from this trade, seen from the other side.
  const cardsOf = (items: readonly TradeItemView[]): DraftCard[] =>
    items.flatMap((item) =>
      item.kind === "card" && item.printingId && item.finish && item.quantity
        ? [{ printingId: item.printingId, finish: item.finish, quantity: item.quantity }]
        : [],
    );
  const moneyOf = (items: readonly TradeItemView[]) => {
    const money = items.find((item) => item.kind === "money");
    return money?.amountCents ? Cents.toPlainDollars(Cents.of(money.amountCents)) : "";
  };
  const counterHref = draftHref({
    withUserId: trade.proposer.userId,
    give: cardsOf(fromRecipient),
    get: cardsOf(fromProposer),
    giveMoney: moneyOf(fromRecipient),
    getMoney: moneyOf(fromProposer),
    replaces: String(trade.id),
    mine: "",
    theirs: "",
  });

  const decide = (decision: string, label: string, style: string) => (
    <form action={decideTradeAction}>
      <input type="hidden" name="tradeId" value={trade.id} />
      <input type="hidden" name="decision" value={decision} />
      <button type="submit" className={`${button} ${style}`}>
        {label}
      </button>
    </form>
  );

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          Trade: {trade.proposer.displayName} ⇄ {trade.recipient.displayName}
        </h1>
        <p className="text-sm text-zinc-500">
          {STATUS_LABELS[trade.status]} · proposed <LocalTime iso={trade.createdAt} withTime />
          {trade.replacesId !== null && (
            <>
              {" "}
              · a counter-offer to{" "}
              <Link href={`/trades/${trade.replacesId}`} className="underline">
                trade {trade.replacesId}
              </Link>
            </>
          )}{" "}
          ·{" "}
          <Link href="/trades" className="underline">
            all trades
          </Link>
        </p>
      </header>
      {typeof error === "string" && <Alert tone="error">{error}</Alert>}
      {trade.message && (
        <blockquote className="border-l-4 border-zinc-300 pl-3 text-sm italic dark:border-zinc-700">
          {trade.message}
        </blockquote>
      )}

      <div className="flex flex-col gap-4 sm:flex-row">
        <Side title={`${trade.proposer.displayName} gives`} items={fromProposer} />
        <Side title={`${trade.recipient.displayName} gives`} items={fromRecipient} />
      </div>

      {isOpen && trade.yourSide === "recipient" && (
        <div className="flex flex-wrap gap-3">
          {decide("accept", "Accept", "bg-green-700 text-white")}
          {decide("decline", "Decline", "border border-zinc-300 dark:border-zinc-700")}
          <Link
            href={counterHref}
            className={`${button} border border-zinc-300 dark:border-zinc-700`}
          >
            Counter-offer
          </Link>
        </div>
      )}
      {isOpen && trade.yourSide === "proposer" && (
        <div className="flex gap-3">
          <p className="text-sm text-zinc-500">Waiting for {trade.recipient.displayName}.</p>
          {decide("cancel", "Cancel this offer", "border border-zinc-300 dark:border-zinc-700")}
        </div>
      )}
    </main>
  );
}
