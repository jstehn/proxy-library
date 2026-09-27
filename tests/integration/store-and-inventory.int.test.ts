// Buying and opening sealed product against real Postgres (design doc 06, section 12), with the
// catalog loaded from recorded fixtures (no network).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SealedProductId } from "@/modules/catalog";
import { makeInventory, type Item } from "@/modules/inventory";
import { makeStore } from "@/modules/store";
import { Cents } from "@/shared/kernel";
import { randomSeed } from "@/shared/runtime";
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
const inventory = makeInventory({ unitOfWork, clock, seeds: { newSeed: randomSeed } });

const PLAY_PACK = SealedProductId.of("1370435e-4972-553f-9dac-dc72408625ea");
const BUNDLE = SealedProductId.of("ec99d990-704c-5ad3-ae7f-f1dbc5fd5ceb");
const jack = actor("jack");
const admin = actor("admin", true);

beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack", "admin"]));

async function buy(productId: SealedProductId, quantity = 1): Promise<Item[]> {
  const result = await store.buySealed(jack, { productId, quantity });
  if (!result.ok) throw new Error(`purchase failed: ${result.error.kind}`);
  return [...result.value.items];
}

describe("buying sealed product", () => {
  it("charges the MSRP and records the sale, the payment and the item together", async () => {
    const [pack] = await buy(PLAY_PACK);

    expect(pack).toMatchObject({
      status: "unopened",
      content: { kind: "pack", boosterType: "play" },
    });
    expect(await balance("jack")).toBe(5000 - 549);
    const [transaction] = (
      await db.execute<{ id: number; total_cents: number }>(
        sql`select id, total_cents from store_transactions`,
      )
    ).rows;
    expect(Number(transaction.total_cents)).toBe(549);
    expect(await count("ledger_entries", `ref = 'store:${transaction.id}'`)).toBe(1);
  });

  it("rolls everything back when the wallet can't pay", async () => {
    const result = await store.buySealed(jack, { productId: BUNDLE, quantity: 1 }); // $59.99 > $50
    expect(result).toEqual({
      ok: false,
      error: { kind: "InsufficientFunds", balance: Cents.of(5000), required: Cents.of(5999) },
    });
    expect(await count("store_transactions")).toBe(0);
    expect(await count("sealed_items")).toBe(0);
  });
});

describe("opening", () => {
  it("opens a pack into the collection, logging every card and keeping the seed", async () => {
    const [pack] = await buy(PLAY_PACK);
    const result = await inventory.openItem(jack, pack.id);
    if (!result.ok || result.value.kind !== "pack") throw new Error("expected a pack");

    expect(await count("sealed_items", `id = ${pack.id} and status = 'opened'`)).toBe(1);
    expect(await count("item_openings", `item_id = ${pack.id} and seed is not null`)).toBe(1);
    const copies = await db.execute<{ total: number }>(
      sql`select sum(quantity)::int as total from collection_cards where user_id = 'jack'`,
    );
    expect(copies.rows[0].total).toBe(result.value.pack.cards.length);
    // Rule 7: quantities always equal the sum of the acquisitions log.
    const mismatches = await db.execute(sql`
      select c.printing_id from collection_cards c
       where c.quantity <> (select sum(a.quantity) from acquisitions a
                             where a.user_id = c.user_id and a.printing_id = c.printing_id
                               and a.finish = c.finish)
    `);
    expect(mismatches.rows).toEqual([]);
  });

  it("opens a pack only once, even when asked twice at the same moment", async () => {
    const [pack] = await buy(PLAY_PACK);
    const results = await Promise.all([
      inventory.openItem(jack, pack.id),
      inventory.openItem(jack, pack.id),
    ]);
    expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
    expect(await count("item_openings")).toBe(1);
  });

  it("opens a whole bundle: 9 packs, the land pack and the promo card", async () => {
    await store.setProductPrice(admin, { productId: BUNDLE, price: Cents.of(100) });
    const [bundle] = await buy(BUNDLE);
    const result = await inventory.openAll(jack, [bundle.id]);
    if (!result.ok) throw new Error(result.error.kind);

    const kinds = result.value.map((opening) => opening.kind);
    expect(kinds.filter((kind) => kind === "pack")).toHaveLength(9);
    expect(kinds.filter((kind) => kind === "deck")).toHaveLength(1);
    expect(await count("sealed_items", "status = 'unopened'")).toBe(0);
    expect(await count("acquisitions", "source = 'product'")).toBe(1); // the foil promo
    expect(await count("acquisitions", "source = 'deck'")).toBeGreaterThan(0);
  });
});
