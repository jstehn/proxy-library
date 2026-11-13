import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { inMemoryEventRecorder } from "@/modules/activity/testing/fakes";
import { PrintingId } from "@/modules/catalog";
import { inMemoryCollectionRepository } from "@/modules/collection/testing/fakes";
import {
  inMemoryItemRepository,
  inMemoryProductCatalog,
  SAMPLE_DECKS,
  SAMPLE_PRODUCTS,
} from "@/modules/inventory/testing/fakes";
import { expectedPackValue } from "@/modules/packs";
import { inMemoryBoosterSource } from "@/modules/packs/testing/fakes";
import { SAMPLE_BOOSTER, SAMPLE_FACTS } from "@/modules/packs/testing/recipes";
import { inMemoryWalletServices } from "@/modules/wallet/testing/fakes";
import { Cents, UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import {
  inMemoryMarketPrices,
  inMemoryPriceList,
  inMemoryProductValues,
  inMemoryStoreLedger,
  inMemoryStoreSettings,
} from "../testing/fakes";
import type { PricingMode } from "../domain/pricing";
import type { Listing } from "./ports";
import { makeStore } from "./make-store";

// Valuing sealed products and the resale floor at the till (design doc 27), against the sample
// booster, products and decks.

const now = new Date("2026-11-07T04:30:00Z");
const jack: Actor = {
  userId: UserId.of("jack"),
  username: "jack" as Actor["username"],
  displayName: "jack" as Actor["displayName"],
  isAdmin: false,
  canSelfFund: false,
  mustChangePassword: false,
};

const PACK_VALUE = expectedPackValue(SAMPLE_BOOSTER, (id) => SAMPLE_FACTS.get(id));
const price = (id: string, finish: "nonfoil" | "foil") =>
  SAMPLE_FACTS.get(PrintingId.of(id))?.marketPrice[finish] ?? 0;

let productValues: ReturnType<typeof inMemoryProductValues>;
let storeLedger: ReturnType<typeof inMemoryStoreLedger>;
let store: ReturnType<typeof makeStore>;

function setUp(listing: Partial<Listing> = {}, pricingMode: PricingMode = "msrp") {
  productValues = inMemoryProductValues(["pack", "box", "bundle", "kit", "gone"], "2026-11-06");
  storeLedger = inMemoryStoreLedger();
  const wallet = inMemoryWalletServices(["jack"]);
  const services = {
    ...wallet.services,
    items: inMemoryItemRepository(),
    productCatalog: inMemoryProductCatalog(Object.values(SAMPLE_PRODUCTS), SAMPLE_DECKS),
    boosters: inMemoryBoosterSource([SAMPLE_BOOSTER], SAMPLE_FACTS),
    collection: inMemoryCollectionRepository(),
    priceList: inMemoryPriceList([
      {
        productId: SAMPLE_PRODUCTS.pack.id,
        name: SAMPLE_PRODUCTS.pack.name,
        kind: "booster_pack/default",
        isSetEnabled: true,
        kindPrice: Cents.of(399),
        officialMsrp: null,
        override: null,
        contentsValue: Cents.of(127_627),
        ...listing,
      },
    ]),
    storeLedger,
    marketPrices: inMemoryMarketPrices({}),
    storeSettings: inMemoryStoreSettings(5000, pricingMode),
    productValues,
    events: inMemoryEventRecorder(),
  };
  store = makeStore({ unitOfWork: inMemoryUnitOfWork(services), clock: fixedClock(now) });
}

beforeEach(() => setUp());

describe("valueProducts", () => {
  it("values every listed product from its packs, cards, decks and nested products", async () => {
    const report = await store.valueProducts();
    expect(report).toEqual({ products: 4, partial: 0, priceDay: "2026-11-06" });

    const valueOf = (id: string) => productValues.state.values.find((v) => v.productId === id);
    const lands = 5 * price("l-forest", "nonfoil") + 5 * price("l-island", "nonfoil");
    expect(valueOf("pack")).toMatchObject({ value: Math.floor(PACK_VALUE), isPartial: false });
    expect(valueOf("box")?.value).toBe(Math.floor(3 * PACK_VALUE));
    expect(valueOf("bundle")?.value).toBe(
      Math.floor(price("m-1", "foil") + 2 * PACK_VALUE + lands),
    );
    // A kit holds one of two decks at random: the average of both. ("gone" isn't in the catalog.)
    const otherDeck = 2 * price("c-W1", "nonfoil");
    expect(valueOf("kit")?.value).toBe(Math.floor((lands + otherDeck) / 2));
    expect(valueOf("gone")).toBeUndefined();
  });

  it("revalues only when there are newer prices than the stored values", async () => {
    expect(await store.valueProductsIfStale()).not.toBeNull();
    expect(await store.valueProductsIfStale()).toBeNull();
    productValues.state.newestPriceDay = "2026-11-07";
    expect(await store.valueProductsIfStale()).toMatchObject({ priceDay: "2026-11-07" });
  });

  it("does nothing before there are any prices", async () => {
    productValues.state.newestPriceDay = null;
    expect(await store.valueProducts()).toBeNull();
    expect(productValues.state.values).toEqual([]);
  });
});

describe("buySealed at the store price", () => {
  it("charges the MSRP in MSRP pricing even when contents sell back for more", async () => {
    const result = await store.buySealed(jack, { productId: SAMPLE_PRODUCTS.pack.id, quantity: 1 });
    expect(result.ok).toBe(true);
    expect(storeLedger.purchases.at(-1)).toMatchObject({ unitPrice: 399 });
  });

  it("charges what the contents sell back for when that's more than the MSRP in value-based pricing (rule 1)", async () => {
    setUp({}, "value");
    const result = await store.buySealed(jack, { productId: SAMPLE_PRODUCTS.pack.id, quantity: 1 });
    // $3.99 a pack whose cards average $1,276.27: sold back at 50%, $638.14 (rounded up).
    // (The in-memory unit of work doesn't roll back the store's record; Postgres does.)
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "InsufficientFunds", required: 63_814 },
    });

    setUp({ contentsValue: Cents.of(9_000) }, "value");
    const affordable = await store.buySealed(jack, {
      productId: SAMPLE_PRODUCTS.pack.id,
      quantity: 1,
    });
    expect(affordable.ok).toBe(true);
    expect(storeLedger.purchases.at(-1)).toMatchObject({ unitPrice: 4_500 });
  });

  it("doesn't sell a kind-priced product before its first valuation in value-based pricing (decision 3)", async () => {
    setUp({ contentsValue: null }, "value");
    expect(
      await store.buySealed(jack, { productId: SAMPLE_PRODUCTS.pack.id, quantity: 1 }),
    ).toEqual({ ok: false, error: { kind: "ProductNotForSale" } });
  });
});
