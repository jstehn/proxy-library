import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { inMemoryEventRecorder } from "@/modules/activity/testing/fakes";
import { PrintingId } from "@/modules/catalog";
import { inMemoryCollectionRepository } from "@/modules/collection/testing/fakes";
import { inMemoryItemRepository, inMemoryProductCatalog } from "@/modules/inventory/testing/fakes";
import { inMemoryBoosterSource } from "@/modules/packs/testing/fakes";
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

// Buying and selling singles (design doc 07), against in-memory wallet, collection and store.

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
const bolt = PrintingId.of("bolt");
const penny = PrintingId.of("penny");
const oldSet = PrintingId.of("old");
const tarmo = PrintingId.of("tarmo");

let wallet: ReturnType<typeof inMemoryWalletServices>;
let collection: ReturnType<typeof inMemoryCollectionRepository>;
let storeLedger: ReturnType<typeof inMemoryStoreLedger>;
let store: ReturnType<typeof makeStore>;
let events: ReturnType<typeof inMemoryEventRecorder>;

beforeEach(() => {
  events = inMemoryEventRecorder();
  wallet = inMemoryWalletServices(["jack", "admin"]);
  collection = inMemoryCollectionRepository();
  storeLedger = inMemoryStoreLedger();
  const services = {
    ...wallet.services,
    items: inMemoryItemRepository(),
    productCatalog: inMemoryProductCatalog([]),
    boosters: inMemoryBoosterSource([], new Map()),
    collection,
    priceList: inMemoryPriceList([]),
    storeLedger,
    marketPrices: inMemoryMarketPrices({
      "bolt/nonfoil": { price: Cents.of(199), day: "2026-01-06", isSetEnabled: true },
      "penny/nonfoil": { price: Cents.of(1), day: "2026-01-06", isSetEnabled: true },
      "old/nonfoil": { price: Cents.of(500), day: "2026-01-06", isSetEnabled: false },
      "tarmo/nonfoil": { price: Cents.of(3000), day: "2026-01-06", isSetEnabled: true },
    }),
    storeSettings: inMemoryStoreSettings(),
    events,
  };
  store = makeStore({ unitOfWork: inMemoryUnitOfWork(services), clock: fixedClock(now) });
});

const kinds = () =>
  wallet.services.wallets.entriesFor(jack.userId).map((entry) => [entry.kind, entry.amount]);
const owned = (printingId: string) => collection.quantity(jack.userId, printingId);

describe("buySingle", () => {
  it("charges market price and adds the cards, logged as from the store (rules 1, 2)", async () => {
    const result = await store.buySingle(jack, {
      printingId: bolt,
      finish: "nonfoil",
      quantity: 3,
    });
    expect(result).toEqual({
      ok: true,
      value: { transactionId: 1, unitPrice: 199, total: 597, priceDay: "2026-01-06" },
    });
    expect(owned("bolt")).toBe(3);
    expect(kinds()).toEqual([
      ["starting_grant", 5000],
      ["purchase_single", -597],
    ]);
    expect(storeLedger.singles[0]).toMatchObject({
      direction: "buy",
      rateBps: 10_000,
      unitMarket: 199,
    });
    expect(collection.log[0]).toMatchObject({ source: "store", ref: "store:1" });
  });

  it("refuses a finish with no price, and a card from a set that isn't enabled (rules 1, 7)", async () => {
    expect(await store.buySingle(jack, { printingId: bolt, finish: "foil", quantity: 1 })).toEqual(
      err({ kind: "NoPrice" }),
    );
    expect(
      await store.buySingle(jack, { printingId: oldSet, finish: "nonfoil", quantity: 1 }),
    ).toEqual(err({ kind: "NotForSale" }));
  });

  it("refuses when the wallet can't pay, adding no cards", async () => {
    // Two $30 cards are $60, and a new wallet has $50.
    expect(
      await store.buySingle(jack, { printingId: tarmo, finish: "nonfoil", quantity: 2 }),
    ).toEqual(
      err({ kind: "InsufficientFunds", balance: Cents.of(5000), required: Cents.of(6000) }),
    );
    expect(owned("tarmo")).toBe(0);
  });
});

describe("sellSingle", () => {
  beforeEach(async () => {
    await store.buySingle(jack, { printingId: bolt, finish: "nonfoil", quantity: 3 });
  });

  it("pays the buylist rate, rounded down per copy, and takes the cards (rules 3, 4)", async () => {
    const result = await store.sellSingle(jack, {
      printingId: bolt,
      finish: "nonfoil",
      quantity: 2,
    });
    // $1.99 at 50% is $0.995 → $0.99 a copy, $1.98 for two.
    expect(result.ok && result.value).toMatchObject({ unitPrice: 99, total: 198 });
    expect(owned("bolt")).toBe(1);
    expect(kinds().at(-1)).toEqual(["sellback", 198]);
    expect(storeLedger.singles.at(-1)).toMatchObject({
      direction: "sell",
      rateBps: 5000,
      unitMarket: 199,
    });
    expect(collection.log.at(-1)).toMatchObject({
      source: "sale",
      gains: [expect.objectContaining({ quantity: -2 })],
    });
  });

  it("refuses to sell more than you own, and pays nothing", async () => {
    expect(
      await store.sellSingle(jack, { printingId: bolt, finish: "nonfoil", quantity: 4 }),
    ).toEqual(
      err({ kind: "NotEnoughCopies", printingId: bolt, finish: "nonfoil", owned: 3, needed: 4 }),
    );
    expect(kinds().at(-1)?.[0]).toBe("purchase_single");
  });

  it("refuses a card worth less than a cent to the store (rule 4)", async () => {
    await store.buySingle(jack, { printingId: penny, finish: "nonfoil", quantity: 1 });
    expect(
      await store.sellSingle(jack, { printingId: penny, finish: "nonfoil", quantity: 1 }),
    ).toEqual(err({ kind: "WorthNothing" }));
  });

  it("uses the current rate, and buys nothing at 0% (rule 5)", async () => {
    await store.setBuylistRate(admin, 7000);
    const sold = await store.sellSingle(jack, { printingId: bolt, finish: "nonfoil", quantity: 1 });
    expect(sold.ok && sold.value.unitPrice).toBe(139); // $1.393 → $1.39
    await store.setBuylistRate(admin, 0);
    expect(
      await store.sellSingle(jack, { printingId: bolt, finish: "nonfoil", quantity: 1 }),
    ).toEqual(err({ kind: "NotBuying" }));
  });
});

describe("setBuylistRate", () => {
  it("is admin-only, from 0% to 100%", async () => {
    expect(await store.setBuylistRate(jack, 5000)).toEqual(err({ kind: "Forbidden" }));
    expect(await store.setBuylistRate(admin, 10_001)).toEqual(err({ kind: "RateInvalid" }));
    expect((await store.setBuylistRate(admin, 10_000)).ok).toBe(true);
  });
});
