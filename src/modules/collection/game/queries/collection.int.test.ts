import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { collectionQueries } from "@/modules/collection";
import {
  actor,
  close,
  db,
  loadFixtureCatalog,
  resetPlayers,
} from "../../../../../tests/integration/harness";

afterAll(close);
beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack"]));

const jack = actor("jack");

/** Dawn's Truce has two printings in the fixture catalog: #9 ($9.82) and #295 ($14.20). */
async function printingOf(name: string, collectorNumber: string): Promise<string> {
  const result = await db.execute<{ id: string }>(
    sql`select id from printings where name = ${name} and collector_number = ${collectorNumber}`,
  );
  return result.rows[0].id;
}

async function give(
  printingId: string,
  finish: "nonfoil" | "foil",
  quantity: number,
  acquiredAt: string,
) {
  await db.execute(sql`
    insert into collection_cards (user_id, printing_id, finish, quantity)
    values (${jack.userId}, ${printingId}, ${finish}, ${quantity})
    on conflict (user_id, printing_id, finish) do update set quantity = collection_cards.quantity + excluded.quantity
  `);
  await db.execute(sql`
    insert into acquisitions (user_id, printing_id, finish, quantity, source, ref, created_at)
    values (${jack.userId}, ${printingId}, ${finish}, ${quantity}, 'store', 'test', ${acquiredAt}::timestamptz)
  `);
}

describe("collection page stacking", () => {
  it("stacks different printings of the same card with the most valuable on top", async () => {
    const regular = await printingOf("Dawn's Truce", "9");
    const extended = await printingOf("Dawn's Truce", "295");
    await give(regular, "nonfoil", 2, "2026-01-01T00:00:00Z");
    await give(extended, "nonfoil", 1, "2026-01-02T00:00:00Z");

    const stacked = await collectionQueries.page(db, jack, {
      sections: "color",
      sort: "name",
      page: 1,
      stackPrintings: true,
    });

    expect(stacked.totals.different).toBe(1);
    expect(stacked.totals.copies).toBe(3);
    expect(stacked.totals.valueCents).toBe(982 * 2 + 1420);
    expect(stacked.rows).toHaveLength(1);
    expect(stacked.rows[0]).toMatchObject({
      printingId: extended,
      finish: "nonfoil",
      quantity: 3,
      price: 1420,
      variants: [
        { printingId: extended, finish: "nonfoil", quantity: 1, price: 1420 },
        { printingId: regular, finish: "nonfoil", quantity: 2, price: 982 },
      ],
    });
    expect(stacked.rows[0].lastAcquiredAt?.toISOString()).toBe("2026-01-02T00:00:00.000Z");

    const unstacked = await collectionQueries.page(db, jack, {
      sections: "none",
      sort: "name",
      page: 1,
    });
    expect(unstacked.totals.different).toBe(2);
    expect(unstacked.rows).toHaveLength(2);
    expect(unstacked.rows[0].variants).toBeUndefined();
  });

  it("supports newest and value sorts when stacking printings", async () => {
    const regular = await printingOf("Dawn's Truce", "9");
    const extended = await printingOf("Dawn's Truce", "295");
    const carrot = await printingOf("Carrot Cake", "7");
    await give(regular, "nonfoil", 2, "2026-01-01T00:00:00Z");
    await give(extended, "nonfoil", 1, "2026-01-03T00:00:00Z");
    await give(carrot, "nonfoil", 1, "2026-01-02T00:00:00Z");

    const byNewest = await collectionQueries.page(db, jack, {
      sections: "none",
      sort: "newest",
      page: 1,
      stackPrintings: true,
    });
    expect(byNewest.rows.map((row) => row.printingId)).toEqual([extended, carrot]);

    const byValue = await collectionQueries.page(db, jack, {
      sections: "none",
      sort: "value",
      page: 1,
      stackPrintings: true,
    });
    expect(byValue.rows.map((row) => row.printingId)).toEqual([extended, carrot]);
  });
});
