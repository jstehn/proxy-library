import Link from "next/link";
import { notFound } from "next/navigation";
import { FINISHES } from "@/modules/catalog";
import { MAX_QUANTITY, payoutPerCopy, type SingleHistoryRow } from "@/modules/store";
import { readPage } from "@/server/page-instance";
import { Cents } from "@/shared/kernel";
import { type Finish } from "@/shared/mtg";
import { LocalTime } from "@/ui/local-time";
import { ManaStylesheet } from "@/ui/mtg/mana";
import { PriceChart, type ChartMarker } from "@/ui/mtg/price-chart";
import { KeyruneStylesheet, SetSymbol } from "@/ui/mtg/set-symbol";
import { AddWishForm } from "@/app/wishlist/wish-forms";
import { RealCopiesBox } from "./real-copies";
import { BuyForm, SellForm } from "./trade-forms";
import { Card } from "@/ui/card";
import { CardView } from "@/ui/mtg/card-view";
import { Page } from "@/ui/page";

// One card: what it is, what it's worth over time, what you own, and buying or selling it
// (design doc 07, section 10).

const FINISH_LABELS: Record<Finish, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
};
const WISH_FINISHES = { nonfoil: "nonfoil", foil: "foil", cheapest: "either finish" };
const FINISH_COLORS: Record<Finish, string> = {
  nonfoil: "#52525b",
  foil: "#0ea5e9",
  etched: "#a855f7",
};

export default async function CardPage(props: PageProps<"/cards/[id]">) {
  const { actor, reads } = await readPage();
  const { id } = await props.params;
  const detail = await reads.catalog.printingDetail(id);
  if (detail === null) notFound();

  const [history, owned, trades, rateBps, inDecks, realCopies, samePrintings, wishes] =
    await Promise.all([
      reads.catalog.priceHistory(id),
      reads.collection.ownedCopies(actor, id),
      reads.store.singleHistory(actor, id),
      reads.store.buylistRate(),
      reads.decks.decksUsing(actor, [id]),
      reads.realCollection.copiesOf(actor, id),
      reads.realCollection.printingsOfSameCard(id),
      reads.wishlist.forCard(actor, id),
    ]);
  const searchParams = await props.searchParams;
  const realError = typeof searchParams.realError === "string" ? searchParams.realError : null;
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
    <Page width="5xl" spacing="roomy">
      <KeyruneStylesheet />
      <ManaStylesheet />
      <CardView
        printingId={card.id}
        name={card.name}
        hasImage={card.hasImage}
        faces={card.faces}
        textStyle="plain"
        desktopImage="wide"
        heading={
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">{card.name}</h1>
            <p className="text-muted flex items-center gap-2 text-sm">
              <SetSymbol keyruneCode={detail.keyruneCode} />
              <Link href={`/sets/${detail.setCode}`} className="underline">
                {detail.setName}
              </Link>
              · #{card.collectorNumber} · {card.rarity}
              {card.variantLabel && ` · ${card.variantLabel}`}
            </p>
          </header>
        }
      >
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="font-medium">In your decks</h2>
          {decks.length === 0 ? (
            <p className="text-muted">No deck uses this card.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-3">
              {decks.map((deck) => (
                <li key={deck.id}>
                  <Link href={`/decks/${deck.id}`} className="underline">
                    {deck.name}
                  </Link>{" "}
                  <span className="text-muted">({deck.quantity})</span>
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
              <Card key={finish} padding="md" className="flex flex-col gap-2">
                <p className="text-sm">
                  <strong>{FINISH_LABELS[finish]}</strong> ·{" "}
                  {price === undefined ? "no market price" : `${Cents.format(price)} market`} · you
                  own {copies}
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
              </Card>
            );
          })}
          <p className="text-muted text-xs">
            The store buys cards at {rateBps / 100}% of market price, rounded down.
          </p>
        </section>

        <section className="flex flex-col gap-2 text-sm">
          <h2 className="font-medium">Wishlist</h2>
          {wishes.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {wishes.map((wish) => (
                <li key={wish.id}>
                  ★ On your{" "}
                  <Link href="/wishlist" className="underline">
                    wishlist
                  </Link>
                  : {wish.quantity} {wish.quantity === 1 ? "copy" : "copies"},{" "}
                  {wish.target.kind === "anyPrinting"
                    ? `any printing (${WISH_FINISHES[wish.target.finish]})`
                    : wish.target.printingId === card.id
                      ? `this printing (${wish.target.finish})`
                      : `another printing (${wish.target.finish})`}
                  {wish.targetPrice !== null && `, target ${Cents.format(wish.targetPrice)}`}
                </li>
              ))}
            </ul>
          )}
          <details className="border-border-subtle rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">
              {wishes.length > 0 ? "Add or change a wish" : "Add to wishlist"}
            </summary>
            <div className="mt-3">
              <AddWishForm
                printingId={card.id}
                finishes={finishes}
                printingLabel={`${detail.setCode.toUpperCase()} #${card.collectorNumber}${card.variantLabel ? `, ${card.variantLabel}` : ""}`}
              />
            </div>
            <p className="text-muted mt-2 text-xs">
              Wishing for the same thing again changes that wish instead of adding another.
            </p>
          </details>
        </section>

        <RealCopiesBox
          printingId={card.id}
          finishes={finishes}
          copies={realCopies}
          printings={samePrintings}
          error={realError}
        />
      </CardView>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Price history</h2>
        {Object.values(history).every((points) => (points?.length ?? 0) <= 1) && (
          <p className="text-muted text-sm">
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
    </Page>
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
            <span className="text-muted">
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
