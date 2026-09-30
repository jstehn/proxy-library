import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { inMemoryEventRecorder } from "@/modules/activity/testing/fakes";
import { SealedProductId } from "@/modules/catalog";
import { inMemoryCollectionRepository } from "@/modules/collection/testing/fakes";
import {
  inMemoryItemRepository,
  inMemoryProductCatalog,
  SAMPLE_DECKS,
  SAMPLE_PRODUCTS,
} from "@/modules/inventory/testing/fakes";
import { inMemoryBoosterSource } from "@/modules/packs/testing/fakes";
import { SAMPLE_BOOSTER, SAMPLE_FACTS } from "@/modules/packs/testing/recipes";
import { inMemoryWalletServices } from "@/modules/wallet/testing/fakes";
import { Cents, err, UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import {
  inMemoryMarketPrices,
  inMemoryPriceList,
  inMemoryStoreLedger,
  inMemoryStoreSettings,
} from "../testing/fakes";
import { makeStore } from "./make-store";
import type { Listing } from "./ports";

// Buying sealed product, against in-memory wallet, inventory and store records. (Rolling back a
// failed purchase is a database job, tested in tests/integration.)

function actor(id: string, isAdmin = false): Actor {
  return {
    userId: UserId.of(id),
    username: id as Actor["username"],
    displayName: id as Actor["displayName"],
    isAdmin,
    canSelfFund: false,
    mustChangePassword: false,
  };
}

const jack = actor("jack");
const admin = actor("admin", true);
const now = new Date("2026-01-07T10:00:00Z");

const packListing: Listing = {
  productId: SAMPLE_PRODUCTS.pack.id,
  name: SAMPLE_PRODUCTS.pack.name,
  kind: "booster_pack/play",
  isSetEnabled: true,
  kindPrice: Cents.of(549),
  officialMsrp: null,
  override: null,
};
const boxListing: Listing = {
  ...packListing,
  productId: SAMPLE_PRODUCTS.box.id,
  name: SAMPLE_PRODUCTS.box.name,
  kind: "booster_box/play",
  kindPrice: null, // not for sale
};

let wallet: ReturnType<typeof inMemoryWalletServices>;
let items: ReturnType<typeof inMemoryItemRepository>;
let storeLedger: ReturnType<typeof inMemoryStoreLedger>;
let store: ReturnType<typeof makeStore>;
let events: ReturnType<typeof inMemoryEventRecorder>;

beforeEach(() => {
  events = inMemoryEventRecorder();
  wallet = inMemoryWalletServices(["jack", "admin"]);
  items = inMemoryItemRepository();
  storeLedger = inMemoryStoreLedger();
  const services = {
    ...wallet.services,
    items,
    productCatalog: inMemoryProductCatalog(Object.values(SAMPLE_PRODUCTS), SAMPLE_DECKS),
    boosters: inMemoryBoosterSource([SAMPLE_BOOSTER], SAMPLE_FACTS),
    collection: inMemoryCollectionRepository(),
    priceList: inMemoryPriceList([packListing, boxListing]),
    storeLedger,
    marketPrices: inMemoryMarketPrices({}),
    storeSettings: inMemoryStoreSettings(),
    events,
  };
  store = makeStore({ unitOfWork: inMemoryUnitOfWork(services), clock: fixedClock(now) });
});

const entries = () => wallet.services.wallets.entriesFor(jack.userId);

describe("buySealed", () => {
  it("charges the MSRP, records the sale and hands over the items (rules 1, 3)", async () => {
    const result = await store.buySealed(jack, { productId: SAMPLE_PRODUCTS.pack.id, quantity: 3 });
    if (!result.ok) throw new Error(result.error.kind);

    expect(result.value.items).toHaveLength(3);
    expect(storeLedger.purchases).toEqual([
      expect.objectContaining({ quantity: 3, unitPrice: 549, total: 1647 }),
    ]);
    // A new wallet gets its $50 starting grant first, then pays $16.47.
    expect(entries().map((entry) => [entry.kind, entry.amount, entry.ref])).toEqual([
      ["starting_grant", 5000, null],
      ["purchase_sealed", -1647, "store:1"],
    ]);
    expect(await wallet.services.wallets.balance(jack.userId)).toBe(5000 - 1647);
    // The feed shows what was bought, never the price.
    expect(events.recorded.map((entry) => entry.event)).toEqual([
      {
        kind: "purchase",
        actorId: jack.userId,
        productName: "Test Play Booster Pack",
        quantity: 3,
      },
    ]);
  });

  it("uses a product's own price over its kind's", async () => {
    await store.setProductPrice(admin, {
      productId: SAMPLE_PRODUCTS.pack.id,
      price: Cents.of(400),
    });
    await store.buySealed(jack, { productId: SAMPLE_PRODUCTS.pack.id, quantity: 1 });
    expect(storeLedger.purchases[0].unitPrice).toBe(400);
  });

  it("refuses products with no price, unknown products, and disabled sets (rules 1, 2)", async () => {
    const notForSale = err({ kind: "ProductNotForSale" });
    expect(await store.buySealed(jack, { productId: SAMPLE_PRODUCTS.box.id, quantity: 1 })).toEqual(
      notForSale,
    );
    expect(
      await store.buySealed(jack, { productId: SealedProductId.of("nope"), quantity: 1 }),
    ).toEqual(notForSale);
    expect(items.itemsOf(jack.userId)).toEqual([]);
  });

  it("refuses a quantity outside 1–24 before touching anything (rule 4)", async () => {
    expect(
      await store.buySealed(jack, { productId: SAMPLE_PRODUCTS.pack.id, quantity: 25 }),
    ).toEqual(err({ kind: "QuantityInvalid", max: 24 }));
    expect(storeLedger.purchases).toEqual([]);
  });

  it("refuses when the wallet can't pay, and hands over nothing (wallet rule 3)", async () => {
    // $50 buys 9 packs at $5.49 ($49.41) but not 10 ($54.90).
    const result = await store.buySealed(jack, {
      productId: SAMPLE_PRODUCTS.pack.id,
      quantity: 10,
    });
    expect(result).toEqual(
      err({ kind: "InsufficientFunds", balance: Cents.of(5000), required: Cents.of(5490) }),
    );
    expect(items.itemsOf(jack.userId)).toEqual([]);
    expect(entries().map((entry) => entry.kind)).toEqual(["starting_grant"]);
  });
});

describe("prices", () => {
  it("are admin-only, and must be $0.01–$10,000 (rule 8)", async () => {
    const input = { kind: "booster_box/play", price: Cents.of(15_000) };
    expect(await store.setKindPrice(jack, input)).toEqual(err({ kind: "Forbidden" }));
    expect((await store.setKindPrice(admin, { ...input, price: Cents.of(0) })).ok).toBe(false);
    expect((await store.setKindPrice(admin, input)).ok).toBe(true);
  });

  it("put a kind on sale when it gets a price, and take it off when cleared", async () => {
    await store.setKindPrice(admin, { kind: "booster_box/play", price: Cents.of(15_000) });
    // $50 isn't enough for a $150 box, but the box is now for sale:
    expect(await store.buySealed(jack, { productId: SAMPLE_PRODUCTS.box.id, quantity: 1 })).toEqual(
      err({ kind: "InsufficientFunds", balance: Cents.of(5000), required: Cents.of(15_000) }),
    );
    await store.setKindPrice(admin, { kind: "booster_box/play", price: null });
    expect(await store.buySealed(jack, { productId: SAMPLE_PRODUCTS.box.id, quantity: 1 })).toEqual(
      err({ kind: "ProductNotForSale" }),
    );
  });

  it("can't give a price to a product that doesn't exist", async () => {
    expect(
      await store.setProductPrice(admin, { productId: SealedProductId.of("nope"), price: null }),
    ).toEqual(err({ kind: "ProductNotFound" }));
  });
});
