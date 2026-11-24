import { sql } from "drizzle-orm";
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

/** Distinct enabled set codes where a card (by oracle id) was printed, sorted alphabetically. */
export async function setCodesOfCard(db: DbExecutor, oracleId: string): Promise<string[]> {
  const rows = await db.execute<{ set_code: string }>(sql`
    select distinct p.set_code
      from printings p
      join card_sets s on s.code = p.set_code and s.is_enabled
     where p.oracle_id = ${oracleId}
     order by p.set_code
  `);
  return rows.rows.map((row) => row.set_code);
}
