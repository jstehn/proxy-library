// Buying and opening sealed product against real Postgres (design doc 06, section 12), with the
// catalog loaded from recorded fixtures (no network).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SealedProductId } from "@/modules/catalog";
import { makeInventory, type Item } from "@/modules/inventory";
import {
  makeStore,
  PRICING_MODES,
  productPrices,
  storePage,
  storePrice,
  type PricingMode,
} from "@/modules/store";
import { drizzlePriceList } from "@/modules/store/infrastructure";
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
beforeEach(async () => {
  await resetPlayers(["jack", "admin"]);
  // These tests are about MSRPs. With the store not buying (0%), there's no resale floor
  // (design doc 27, rule 5); "the resale floor" below turns it back on.
  await db.execute(sql`update store_settings set buylist_rate_bps = 0 where id = 1`);
});

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

describe("official photos, MSRPs and details from WPN (design doc 13)", () => {
  it("shows the photos and WPN's details; a case keeps its generated art", async () => {
    const page = await storePage(db, "BLB");
    const product = (name: string) => page?.products.find((p) => p.name === name);
    expect(page?.set.keyArtId).toMatch(/^[A-Za-z0-9]+-[a-f0-9]{12}$/);
    expect(product("Bloomburrow Play Booster Pack")?.photoIds).toHaveLength(1);
    expect(product("Bloomburrow Play Booster Pack")?.contents.length).toBeGreaterThan(0);
    expect(product("Bloomburrow Play Booster Pack")?.releaseDate).toBe("2024-08-02");
    expect(product("Bloomburrow Play Booster Box Case")?.photoIds ?? []).toEqual([]);
  });

  it("charges Wizards' official MSRP when it has one, and an admin's own price over that", async () => {
    // Bloomburrow's recorded page lists no MSRPs, so give its Play Booster one.
    await db.execute(
      sql`update wpn_products set msrp_cents = 599 where name = 'Bloomburrow Play Booster'`,
    );
    const shown = (await storePage(db, "BLB"))?.products.find(
      (p) => p.name === "Bloomburrow Play Booster Pack",
    )?.msrp;
    expect(shown).toBe(599); // not the kind's $5.49
    await buy(PLAY_PACK);
    expect(await balance("jack")).toBe(5000 - 599);

    await store.setProductPrice(admin, { productId: PLAY_PACK, price: Cents.of(450) });
    await buy(PLAY_PACK);
    expect(await balance("jack")).toBe(5000 - 599 - 450);
    await store.setProductPrice(admin, { productId: PLAY_PACK, price: null });
    await db.execute(sql`update wpn_products set msrp_cents = null`);
  });
});

describe("the resale floor (design doc 27)", () => {
  beforeEach(() => db.execute(sql`update store_settings set buylist_rate_bps = 5000 where id = 1`));

  it("charges what the contents sell back for when that's more than the MSRP", async () => {
    // In the fixture catalog a Bloomburrow play pack's cards sell back for more than $5.49.
    const [row] = (
      await db.execute<{ value_cents: number }>(
        sql`select value_cents from product_values where product_id = ${PLAY_PACK}`,
      )
    ).rows;
    const floor = Math.ceil((Number(row.value_cents) * 5000) / 10_000);
    expect(floor).toBeGreaterThan(549);

    const shown = (await storePage(db, "BLB"))?.products.find((p) => p.id === PLAY_PACK);
    expect(shown).toMatchObject({ msrp: floor, listPrice: 549 });
    await buy(PLAY_PACK);
    expect(await balance("jack")).toBe(5000 - floor);
  });

  it("agrees with storePrice for every product, in every place that shows a price", async () => {
    // A product with an official MSRP above its floor, so the two modes differ (design doc 33).
    await db.execute(
      sql`update wpn_products set msrp_cents = 599 where name = 'Bloomburrow Play Booster'`,
    );
    for (const pricingMode of PRICING_MODES) {
      await db.execute(sql`update store_settings set pricing_mode = ${pricingMode} where id = 1`);
      expect(await pricesAgree(pricingMode)).toBeGreaterThan(0);
    }
    await db.execute(sql`update wpn_products set msrp_cents = null`);
  });

  /** Checks every listed product's price in SQL against storePrice; how many were raised. */
  async function pricesAgree(pricingMode: PricingMode): Promise<number> {
    const listings = await db.execute<{ id: string; set_code: string }>(sql`
      select sp.id, sp.set_code from sealed_products sp
        join card_sets s on s.code = sp.set_code and s.is_enabled
       where sp.is_listed and jsonb_array_length(sp.contents) > 0`);
    const priceList = drizzlePriceList(db);
    const pages = new Map<string, Awaited<ReturnType<typeof storePage>>>();
    let raised = 0;
    for (const row of listings.rows) {
      if (!pages.has(row.set_code)) pages.set(row.set_code, await storePage(db, row.set_code));
      const listing = await priceList.listing(SealedProductId.of(row.id));
      if (listing === null) throw new Error(`no listing for ${row.id}`);
      const expected = storePrice({ ...listing, buylistRateBps: 5000, pricingMode });
      const shown = pages.get(row.set_code)?.products.find((p) => p.id === row.id);
      expect(shown?.msrp ?? null).toBe(expected?.price ?? null);
      const adminRow = (await productPrices(db, row.set_code)).find((p) => p.id === row.id);
      expect(adminRow?.storePrice ?? null).toBe(expected?.price ?? null);
      if (expected?.isRaised) raised++;
    }
    return raised;
  }

  it("sells an official MSRP as published in MSRP pricing, and raises it in value-based (design doc 33)", async () => {
    await db.execute(
      sql`update wpn_products set msrp_cents = 599 where name = 'Bloomburrow Play Booster'`,
    );
    const shown = async () =>
      (await storePage(db, "BLB"))?.products.find((p) => p.id === PLAY_PACK)?.msrp;
    expect(await shown()).toBe(599); // the default, MSRP pricing
    await buy(PLAY_PACK);
    expect(await balance("jack")).toBe(5000 - 599);

    expect(await store.setPricingMode(admin, "value")).toEqual({ ok: true, value: undefined });
    const raised = await shown();
    expect(raised).toBeGreaterThan(599);
    await buy(PLAY_PACK);
    expect(await balance("jack")).toBe(5000 - 599 - Number(raised));
    expect(await store.setPricingMode(actor("jack"), "msrp")).toEqual({
      ok: false,
      error: { kind: "Forbidden" },
    });
    await db.execute(sql`update wpn_products set msrp_cents = null`);
  });

  it("is gone when the store stops buying, and an admin's own price is never raised", async () => {
    await store.setProductPrice(admin, { productId: PLAY_PACK, price: Cents.of(100) });
    expect((await storePage(db, "BLB"))?.products.find((p) => p.id === PLAY_PACK)?.msrp).toBe(100);
    await db.execute(sql`delete from msrp_overrides`);
    await db.execute(sql`update store_settings set buylist_rate_bps = 0 where id = 1`);
    expect((await storePage(db, "BLB"))?.products.find((p) => p.id === PLAY_PACK)?.msrp).toBe(549);
  });

  it("keeps kind-priced products off sale until they're valued, and values them again", async () => {
    await db.execute(sql`delete from product_values`);
    expect((await storePage(db, "BLB"))?.products.find((p) => p.id === PLAY_PACK)).toBeUndefined();
    expect(await store.valueProductsIfStale()).toMatchObject({ partial: 0 });
    expect((await storePage(db, "BLB"))?.products.find((p) => p.id === PLAY_PACK)).toBeDefined();
    expect(await store.valueProductsIfStale()).toBeNull();
  });
});
