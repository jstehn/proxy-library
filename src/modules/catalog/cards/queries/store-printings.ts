import type { DbExecutor } from "@/shared/db";
import type { Actor } from "@/modules/accounts";
import { searchPrintings } from "./catalog";
import { printingCards } from "./printing-cards";

/** One printing of a card that the store sells, with the newest price in each finish (cents). */
export type StorePrinting = Readonly<{
  printingId: string;
  set: string;
  number: string;
  variant: string;
  prices: Readonly<Record<string, number>>;
}>;

/** The printings of a card (by exact name) found in the store, cheapest first, up to `limit`. */
export async function storePrintingsOfCard(
  db: DbExecutor,
  actor: Actor,
  name: string,
  limit: number,
): Promise<StorePrinting[]> {
  const found = await searchPrintings(db, actor, {
    search: `!"${name.replace(/"/g, "")}"`,
    sort: "price",
    page: 1,
  });
  const ids = found.printingIds.slice(0, limit);
  const cards = await printingCards(db, ids);
  return ids.flatMap((id) => {
    const card = cards.get(id);
    if (card === undefined) return [];
    return [
      {
        printingId: id,
        set: card.setCode,
        number: card.collectorNumber,
        variant: card.variantLabel,
        prices: card.prices,
      },
    ];
  });
}
