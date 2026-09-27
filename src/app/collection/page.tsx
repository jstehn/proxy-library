import Link from "next/link";
import { CardTile } from "@/app/_components/card-tile";
import { printingCards } from "@/modules/catalog";
import { collectionFor } from "@/modules/collection";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mana";

const FINISH_NAMES = { nonfoil: "", foil: "Foil ", etched: "Etched " };

export default async function CollectionPage() {
  const actor = await requireActor();
  const { db } = getContainer();
  const owned = await collectionFor(db, actor.userId);
  const cards = await printingCards(
    db,
    owned.map((card) => card.printingId),
  );
  const copies = owned.reduce((total, card) => total + card.quantity, 0);
  const value = Cents.sum(
    owned.map((card) =>
      Cents.of((cards.get(card.printingId)?.prices[card.finish] ?? 0) * card.quantity),
    ),
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <ManaStylesheet />
      <header>
        <h1 className="text-2xl font-semibold">Collection</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {copies} cards ({owned.length} different) worth{" "}
          <strong className="tabular-nums">{Cents.format(value)}</strong> at market price. Newest
          first.
        </p>
      </header>
      {owned.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No cards yet.{" "}
          <Link href="/store" className="underline">
            Buy a pack
          </Link>{" "}
          and open it.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {owned.map((card) => {
            const printing = cards.get(card.printingId);
            if (printing === undefined) return null;
            const price = printing.prices[card.finish];
            return (
              <CardTile
                key={`${card.printingId}/${card.finish}`}
                printing={printing}
                isFoil={card.finish !== "nonfoil"}
                priceLine={`${card.quantity}× · ${FINISH_NAMES[card.finish]}${price === undefined ? "no price" : Cents.format(price)}`}
              />
            );
          })}
        </ul>
      )}
    </main>
  );
}
