import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogQueries } from "@/modules/catalog";
import {
  close,
  db,
  fixtureCatalog,
  loadFixtureCatalog,
} from "../../../../../tests/integration/harness";

afterAll(close);
// The fixture sync runs the features pass (step 5c), so every oracle card has a row afterwards.
beforeAll(loadFixtureCatalog);

async function count(table: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`));
  return rows.rows[0].n;
}

describe("card features", () => {
  it("the sync stored one row per oracle card, and a second pass has nothing to do", async () => {
    const cards = await db.execute<{ n: number }>(
      sql`select count(distinct oracle_id)::int as n from printings`,
    );
    expect(cards.rows[0].n).toBeGreaterThan(0);
    expect(await count("card_features")).toBe(cards.rows[0].n);
    expect(await fixtureCatalog().featuresPass()).toBe(0);
  });

  it("a stored row equals what is worked out from the card now", async () => {
    const ids = (
      await db.execute<{ oracle_id: string }>(sql`select oracle_id from card_features`)
    ).rows.map((row) => row.oracle_id);
    const stored = await catalogQueries.cardFeatures(db, ids);
    expect(stored.size).toBe(ids.length);
    // Without rows, the read works each card out from its text: the same answer.
    await db.execute(sql`delete from card_features`);
    const computed = await catalogQueries.cardFeatures(db, ids);
    expect(computed).toEqual(stored);
  });

  it("a lower stored version is worked out again, and the pass fills the table", async () => {
    expect(await fixtureCatalog().featuresPass()).toBeGreaterThan(0);
    const total = await count("card_features");
    await db.execute(sql`update card_features set features_version = 0`);
    expect(await fixtureCatalog().featuresPass()).toBe(total);
    expect(await fixtureCatalog().featuresPass()).toBe(0);
  });
});
