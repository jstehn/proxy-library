// Buying and selling singles against real Postgres (design doc 07, section 12).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrintingId, searchPrintings } from "@/modules/catalog";
import { collectionPage } from "@/modules/collection";
import { makeStore } from "@/modules/store";
import {
  actor,
  balance,
  clock,
  close,
  count,
  db,
  loadFixtureCatalog,
  resetPlayers,
  unitOfWork,
} from "./harness";

afterAll(close);

const store = makeStore({ unitOfWork, clock });
const jack = actor("jack");

/** A fixture printing with a nonfoil price between $1 and $20, and that price. */
async function affordableCard(): Promise<{ id: PrintingId; name: string; price: number }> {
  const [row] = (
    await db.execute<{ id: string; name: string; usd_cents: number }>(sql`
      select p.id, p.name, s.usd_cents from printings p
        join price_snapshots s on s.printing_id = p.id and s.finish = 'nonfoil'
       where s.usd_cents between 100 and 2000 and p.set_code = 'BLB'
       order by s.usd_cents desc, p.id limit 1
    `)
  ).rows;
  return { id: PrintingId.of(row.id), name: row.name, price: Number(row.usd_cents) };
}

beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack"]));

describe("singles", () => {
  it("buys at market and sells back at half, keeping every ledger in step", async () => {
    const card = await affordableCard();
    const bought = await store.buySingle(jack, {
      printingId: card.id,
      finish: "nonfoil",
      quantity: 2,
    });
    expect(bought.ok).toBe(true);

    const sold = await store.sellSingle(jack, {
      printingId: card.id,
      finish: "nonfoil",
      quantity: 2,
    });
    if (!sold.ok) throw new Error(sold.error.kind);
    const payout = Math.floor(card.price / 2);
    expect(sold.value.unitPrice).toBe(payout);

    expect(await balance("jack")).toBe(5000 - 2 * card.price + 2 * payout);
    expect(await count("collection_cards")).toBe(0); // no rows left at zero
    expect(await count("acquisitions", "source = 'store' and quantity = 2")).toBe(1);
    expect(await count("acquisitions", "source = 'sale' and quantity = -2")).toBe(1);
    expect(await count("store_transactions", "direction = 'sell' and rate_bps = 5000")).toBe(1);
    // The wallet and the store agree on every transaction.
    const mismatched = await db.execute(sql`
      select t.id from store_transactions t
       where not exists (select 1 from ledger_entries l
                          where l.ref = 'store:' || t.id and abs(l.amount_cents) = t.total_cents)
    `);
    expect(mismatched.rows).toEqual([]);
  });

  it("sells your last copy only once, even when asked twice at the same moment", async () => {
    const card = await affordableCard();
    await store.buySingle(jack, { printingId: card.id, finish: "nonfoil", quantity: 1 });
    const results = await Promise.all([
      store.sellSingle(jack, { printingId: card.id, finish: "nonfoil", quantity: 1 }),
      store.sellSingle(jack, { printingId: card.id, finish: "nonfoil", quantity: 1 }),
    ]);
    expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
    expect(results.find((result) => !result.ok)).toMatchObject({
      error: { kind: "NotEnoughCopies", owned: 0 },
    });
    expect(await count("ledger_entries", "kind = 'sellback'")).toBe(1);
  });
});

describe("collectionPage", () => {
  it("divides into color sections, in binder order", async () => {
    const card = await affordableCard();
    await store.buySingle(jack, { printingId: card.id, finish: "nonfoil", quantity: 1 });
    const plains = (
      await db.execute<{ id: string }>(sql`
        select p.id from printings p join price_snapshots s on s.printing_id = p.id and s.finish = 'nonfoil'
         where p.set_code = 'BLB' and p.type_line like 'Basic Land%' limit 1
      `)
    ).rows[0];
    await store.buySingle(jack, {
      printingId: PrintingId.of(plains.id),
      finish: "nonfoil",
      quantity: 1,
    });

    const page = await collectionPage(db, jack.userId, {
      sections: "color",
      sort: "mana",
      page: 1,
    });
    const sections = page.rows.map((row) => row.section);
    expect(sections.at(-1)).toBe("Lands"); // lands come last
    expect(["White", "Blue", "Black", "Red", "Green", "Colorless"]).toContain(sections[0]);
    const byType = await collectionPage(db, jack.userId, {
      sections: "type",
      sort: "name",
      page: 1,
    });
    expect(byType.rows.map((row) => row.section)).toContain("Lands");
  });

  it("gives each multicolored combination its own section and filter", async () => {
    // Byrke is Green-White (Selesnya) and has only a foil price in the fixtures.
    const byrke = (
      await db.execute<{ id: string }>(sql`
        select id from printings where name = 'Byrke, Long Ear of the Law' limit 1
      `)
    ).rows[0];
    const bought = await store.buySingle(jack, {
      printingId: PrintingId.of(byrke.id),
      finish: "foil",
      quantity: 1,
    });
    expect(bought.ok).toBe(true);

    const bySection = await collectionPage(db, jack.userId, {
      sections: "color",
      sort: "name",
      page: 1,
    });
    expect(bySection.rows.map((row) => row.section)).toEqual(["Green-White (Selesnya)"]);

    const selesnya = await collectionPage(db, jack.userId, {
      color: "WG", // any order
      sections: "none",
      sort: "name",
      page: 1,
    });
    expect(selesnya.totals.different).toBe(1);
    const simic = await collectionPage(db, jack.userId, {
      color: "GU",
      sections: "none",
      sort: "name",
      page: 1,
    });
    expect(simic.totals.different).toBe(0);

    // The singles store filters the same way: only Bria is exactly Blue-Red (Izzet).
    const izzet = await searchPrintings(db, { color: "UR", sort: "name", page: 1 });
    const names = await db.execute<{ name: string }>(sql`
      select distinct name from printings
       where id in (${sql.join(
         izzet.printingIds.map((id) => sql`${id}`),
         sql`, `,
       )})
    `);
    expect(names.rows).toEqual([{ name: "Bria, Riptide Rogue" }]);
  });

  it("filters, sorts by value, and totals the whole filtered collection", async () => {
    const card = await affordableCard();
    await store.buySingle(jack, { printingId: card.id, finish: "nonfoil", quantity: 3 });

    const all = await collectionPage(db, jack.userId, { sections: "none", sort: "value", page: 1 });
    expect(all.totals).toEqual({ different: 1, copies: 3, valueCents: 3 * card.price });
    expect(all.rows).toEqual([
      { printingId: card.id, finish: "nonfoil", quantity: 3, price: card.price, section: "" },
    ]);

    const byName = await collectionPage(db, jack.userId, {
      name: card.name.slice(0, 4).toLowerCase(),
      sections: "none",
      sort: "name",
      page: 1,
    });
    expect(byName.rows).toHaveLength(1);
    const foilsOnly = await collectionPage(db, jack.userId, {
      finish: "foil",
      sections: "none",
      sort: "newest",
      page: 1,
    });
    expect(foilsOnly.totals.copies).toBe(0);
  });
});
