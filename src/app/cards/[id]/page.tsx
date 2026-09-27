import Link from "next/link";
import { notFound } from "next/navigation";
import { FINISHES, priceHistory, printingDetail, type Finish } from "@/modules/catalog";
import { ownedCopies } from "@/modules/collection";
import { decksUsing } from "@/modules/decks";
import {
  currentBuylistRate,
  MAX_QUANTITY,
  payoutPerCopy,
  singleHistory,
  type SingleHistoryRow,
} from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { LocalTime } from "@/ui/local-time";
import { ManaStylesheet, ManaText } from "@/ui/mana";
import { PriceChart, type ChartMarker } from "@/ui/price-chart";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";
import { BuyForm, SellForm } from "./trade-forms";

// One card: what it is, what it's worth over time, what you own, and buying or selling it
// (design doc 07, section 10).

const FINISH_LABELS: Record<Finish, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
};
const FINISH_COLORS: Record<Finish, string> = {
  nonfoil: "#52525b",
  foil: "#0ea5e9",
  etched: "#a855f7",
};

export default async function CardPage(props: PageProps<"/cards/[id]">) {
  const actor = await requireActor();
  const { id } = await props.params;
  const { db } = getContainer();
  const detail = await printingDetail(db, id);
  if (detail === null) notFound();

  const [history, owned, trades, rateBps, inDecks] = await Promise.all([
    priceHistory(db, id),
    ownedCopies(db, actor.userId, id),
    singleHistory(db, actor.userId, id),
    currentBuylistRate(db),
    decksUsing(db, actor.userId, [id]),
  ]);
  const decks = inDecks.get(id) ?? [];
  const { card } = detail;
  const finishes = FINISHES.filter((finish) => card.finishes.includes(finish));

  const markers: ChartMarker[] = trades.map((trade) => ({
    day: trade.at.slice(0, 10),
    cents: trade.unitMarket,
    kind: trade.direction,
    label: `${trade.direction === "buy" ? "Bought" : "Sold"} ${trade.quantity} ${trade.finish} for ${Cents.format(trade.unitPrice)} each`,
  }));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12">
      <KeyruneStylesheet />
      <ManaStylesheet />
      <div className="flex flex-col gap-8 md:flex-row">
        {card.hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${card.id}/normal/front`}
            alt={card.name}
            width={488}
            height={680}
            className="aspect-[488/680] w-full max-w-72 self-start rounded-[4.5%] bg-zinc-100 shadow-lg dark:bg-zinc-800"
          />
        ) : null}

        <div className="flex flex-1 flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">{card.name}</h1>
            <p className="flex items-center gap-2 text-sm text-zinc-500">
              <SetSymbol keyruneCode={detail.keyruneCode} />
              <Link href={`/sets/${detail.setCode}`} className="underline">
                {detail.setName}
              </Link>
              · #{card.collectorNumber} · {card.rarity}
              {card.variantLabel && ` · ${card.variantLabel}`}
            </p>
          </header>

          {card.faces.map((face, index) => (
            <section key={index} className="flex flex-col gap-1 text-sm">
              <p className="flex justify-between gap-2 font-medium">
                <span>{face.name}</span>
                {face.manaCost && (
                  <span className="shrink-0">
                    <ManaText text={face.manaCost} />
                  </span>
                )}
              </p>
              <p className="text-zinc-600 italic dark:text-zinc-400">{face.typeLine}</p>
              {face.text.split("\n").map((paragraph, line) => (
                <p key={line}>
                  <ManaText text={paragraph} />
                </p>
              ))}
            </section>
          ))}

          <section className="flex flex-col gap-1 text-sm">
            <h2 className="font-medium">In your decks</h2>
            {decks.length === 0 ? (
              <p className="text-zinc-500">No deck uses this card.</p>
            ) : (
              <ul className="flex flex-wrap gap-x-3">
                {decks.map((deck) => (
                  <li key={deck.id}>
                    <Link href={`/decks/${deck.id}`} className="underline">
                      {deck.name}
                    </Link>{" "}
                    <span className="text-zinc-500">({deck.quantity})</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-medium">Buy and sell</h2>
            {finishes.map((finish) => {
              const price = card.prices[finish];
              const copies = owned[finish] ?? 0;
              const payout = price === undefined ? null : payoutPerCopy(price, rateBps);
              return (
                <div
                  key={finish}
                  className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <p className="text-sm">
                    <strong>{FINISH_LABELS[finish]}</strong> ·{" "}
                    {price === undefined ? "no market price" : `${Cents.format(price)} market`} ·
                    you own {copies}
                  </p>
                  {price !== undefined && detail.isSetEnabled && (
                    <BuyForm
                      printingId={card.id}
                      finish={finish}
                      finishLabel={FINISH_LABELS[finish]}
                      maxQuantity={MAX_QUANTITY}
                      priceText={`${Cents.format(price)} each`}
                    />
                  )}
                  {payout !== null && payout > 0 && (
                    <SellForm
                      printingId={card.id}
                      finish={finish}
                      finishLabel={FINISH_LABELS[finish]}
                      maxQuantity={Math.min(copies, MAX_QUANTITY)}
                      priceText={`${Cents.format(payout)} each`}
                    />
                  )}
                </div>
              );
            })}
            <p className="text-xs text-zinc-500">
              The store buys cards at {rateBps / 100}% of market price, rounded down.
            </p>
          </section>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Price history</h2>
        {Object.values(history).every((points) => (points?.length ?? 0) <= 1) && (
          <p className="text-sm text-zinc-500">
            Prices are recorded once a day, so the chart fills in as the nightly syncs run.
          </p>
        )}
        <PriceChart
          series={finishes.flatMap((finish) => {
            const points = history[finish] ?? [];
            return points.length === 0
              ? []
              : [
                  {
                    label: FINISH_LABELS[finish],
                    color: FINISH_COLORS[finish],
                    points: points.map((point) => ({ day: point.day, cents: point.price })),
                  },
                ];
          })}
          markers={markers}
        />
      </section>

      {trades.length > 0 && <TradeHistory trades={trades} />}
    </main>
  );
}

function TradeHistory(props: { trades: SingleHistoryRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Your store history for this card</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {props.trades.map((trade) => (
          <li key={trade.id}>
            <LocalTime iso={trade.at} withTime /> · {trade.direction === "buy" ? "Bought" : "Sold"}{" "}
            {trade.quantity} {trade.finish} for {Cents.format(trade.total)}
            <span className="text-zinc-500">
              {" "}
              ({Cents.format(trade.unitPrice)} each; market {Cents.format(trade.unitMarket)} on{" "}
              {trade.priceDay}
              {trade.direction === "sell" && ` at ${trade.rateBps / 100}%`})
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
