import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { inMemoryEventRecorder } from "@/modules/activity/testing/fakes";
import { FINISHES } from "@/modules/catalog";
import { inMemoryCollectionRepository } from "@/modules/collection/testing/fakes";
import { inMemoryItemRepository, inMemoryProductCatalog } from "@/modules/inventory/testing/fakes";
import { inMemoryBoosterSource } from "@/modules/packs/testing/fakes";
import {
  inMemoryMarketPrices,
  inMemoryPriceList,
  inMemoryStoreLedger,
  inMemoryStoreSettings,
} from "@/modules/store/testing/fakes";
import { inMemoryWalletServices } from "@/modules/wallet/testing/fakes";
import { Cents, err, UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import type { Offer } from "../domain/lines";
import { WishId, type WishDetails } from "../domain/wish";
import { inMemoryWishCatalog, inMemoryWishRepository } from "../testing/fakes";
import { deleteWishlist, type WishRequest } from "./manage-wishes";
import { makeWishlist } from "./make-wishlist";
import type { PrintingFacts } from "./ports";

// The wishlist's use cases (design doc 26, section 5), against in-memory wishes, store, wallet
// and collection. Jack starts with the $50 starting grant.

function actor(id: string): Actor {
  return {
    userId: UserId.of(id),
    username: id as Actor["username"],
    displayName: id as Actor["displayName"],
    isAdmin: false,
    canSelfFund: false,
    mustChangePassword: false,
  };
}

const jack = actor("jack");
const bob = actor("bob");
const now = new Date("2026-11-06T10:00:00Z");

// The Reaver Cleaver: M3C is the cheapest nonfoil for sale; HOC isn't in an enabled set.
const PRINTINGS: Record<string, PrintingFacts> = {
  m3c: { oracleId: "cleaver", finishes: ["nonfoil", "foil"] },
  dmc: { oracleId: "cleaver", finishes: ["nonfoil"] },
  hoc: { oracleId: "cleaver", finishes: ["nonfoil", "foil"] },
  bolt: { oracleId: "bolt", finishes: ["nonfoil"] },
};
const PRICES: Record<string, number> = {
  "m3c/nonfoil": 2384,
  "m3c/foil": 4100,
  "dmc/nonfoil": 2762,
};

function offer(key: string): Offer {
  const [printingId, finish] = key.split("/") as [string, Offer["finish"]];
  return {
    oracleId: PRINTINGS[printingId].oracleId,
    printingId,
    finish,
    name: "The Reaver Cleaver",
    setCode: printingId.toUpperCase(),
    setName: printingId,
    collectorNumber: "1",
    variantLabel: "",
    releaseDate: "2024-01-01",
    price: Cents.of(PRICES[key]),
  };
}

let wishes: ReturnType<typeof inMemoryWishRepository>;
let collection: ReturnType<typeof inMemoryCollectionRepository>;
let wallet: ReturnType<typeof inMemoryWalletServices>;
let prices: Record<string, { price: Cents; day: string; isSetEnabled: boolean }>;
let wishlist: ReturnType<typeof makeWishlist>;

beforeEach(() => {
  wishes = inMemoryWishRepository();
  collection = inMemoryCollectionRepository();
  wallet = inMemoryWalletServices(["jack", "bob"]);
  prices = Object.fromEntries(
    Object.entries(PRICES).map(([key, cents]) => [
      key,
      { price: Cents.of(cents), day: "2026-11-05", isSetEnabled: true },
    ]),
  );
  const ownedBy = (userId: UserId) =>
    Object.entries(PRINTINGS).flatMap(([printingId, facts]) =>
      FINISHES.map((finish) => ({
        oracleId: facts.oracleId,
        printingId,
        finish,
        quantity: collection.quantity(userId, printingId, finish),
      })).filter((stack) => stack.quantity > 0),
    );
  const services = {
    ...wallet.services,
    items: inMemoryItemRepository(),
    productCatalog: inMemoryProductCatalog([]),
    boosters: inMemoryBoosterSource([], new Map()),
    collection,
    priceList: inMemoryPriceList([]),
    storeLedger: inMemoryStoreLedger(),
    // Read when buying, so a test can change a price after the page "loaded".
    marketPrices: inMemoryMarketPrices(
      new Proxy({}, { get: (_target, key: string) => prices[key] }),
    ),
    storeSettings: inMemoryStoreSettings(),
    events: inMemoryEventRecorder(),
    wishes,
    wishCatalog: inMemoryWishCatalog({
      printings: PRINTINGS,
      forSale: Object.keys(PRICES).map(offer),
      ownedBy,
    }),
  };
  wishlist = makeWishlist({ unitOfWork: inMemoryUnitOfWork(services), clock: fixedClock(now) });
});

const ONE: WishDetails = { quantity: 1, targetPrice: null, note: "" };
const ANY: WishRequest = { kind: "anyPrinting", printingId: "hoc", finish: "nonfoil" };

async function added(request: WishRequest = ANY, details: WishDetails = ONE) {
  const result = await wishlist.addWish(jack, { request, details });
  if (!result.ok) throw new Error(result.error.kind);
  return result.value.wish;
}

describe("addWish", () => {
  it("wishes for the card from any of its printings, saving today's cheapest price", async () => {
    const wish = await added();
    expect(wish.target).toEqual({ kind: "anyPrinting", oracleId: "cleaver", finish: "nonfoil" });
    expect([wish.savedPrice, wish.createdAt]).toEqual([2384, now]);
  });

  it("updates the same wish when added again, keeping the saved price (rule 1)", async () => {
    const first = await added();
    prices["m3c/nonfoil"] = { ...prices["m3c/nonfoil"], price: Cents.of(1000) };
    const again = await wishlist.addWish(jack, {
      request: { ...ANY, printingId: "dmc" }, // another printing of the same card
      details: { quantity: 3, targetPrice: Cents.of(2000), note: "deck" },
    });
    expect(again).toMatchObject({ ok: true, value: { isNew: false, wish: { id: first.id } } });
    expect(wishes.all()).toEqual([
      { ...first, quantity: 3, targetPrice: 2000, note: "deck", savedPrice: 2384 },
    ]);
  });

  it("keeps an exact printing and finish apart from 'any printing'", async () => {
    await added();
    const exact = await added({ kind: "exactPrinting", printingId: "m3c", finish: "foil" });
    expect(exact.target).toEqual({
      kind: "exactPrinting",
      oracleId: "cleaver",
      printingId: "m3c",
      finish: "foil",
    });
    expect(exact.savedPrice).toBe(4100);
    expect(wishes.all()).toHaveLength(2);
  });

  it("saves no price when nothing fits is for sale", async () => {
    const exact = await added({ kind: "exactPrinting", printingId: "hoc", finish: "foil" });
    expect(exact.savedPrice).toBeNull();
  });

  it("refuses a finish the printing wasn't made in (rule 4), an unknown card, bad details", async () => {
    const add = (request: WishRequest, details = ONE) =>
      wishlist.addWish(jack, { request, details });
    expect(await add({ kind: "exactPrinting", printingId: "dmc", finish: "foil" })).toEqual(
      err({ kind: "FinishNotAvailable", finishes: ["nonfoil"] }),
    );
    expect(await add({ ...ANY, printingId: "nope" })).toEqual(err({ kind: "CardNotFound" }));
    expect(await add(ANY, { ...ONE, quantity: 0 })).toEqual(
      err({ kind: "InvalidWish", reason: "Want 1 to 99 copies." }),
    );
  });

  it("refuses the 501st wish (rule 2)", async () => {
    for (let index = 0; index < 500; index++) {
      await wishes.insert({
        userId: jack.userId,
        target: { kind: "anyPrinting", oracleId: `card-${index}`, finish: "nonfoil" },
        ...ONE,
        savedPrice: null,
        createdAt: now,
      });
    }
    expect(await wishlist.addWish(jack, { request: ANY, details: ONE })).toEqual(
      err({ kind: "WishlistFull", max: 500 }),
    );
  });
});

describe("updateWish and removeWish", () => {
  it("change only your own wishes (rule 5)", async () => {
    const wish = await added();
    expect(await wishlist.updateWish(bob, wish.id, ONE)).toEqual(err({ kind: "WishNotFound" }));
    expect(await wishlist.removeWish(bob, wish.id)).toEqual(err({ kind: "WishNotFound" }));

    const updated = await wishlist.updateWish(jack, wish.id, { ...ONE, quantity: 2 });
    expect(updated).toMatchObject({ ok: true, value: { quantity: 2 } });
    expect((await wishlist.removeWish(jack, wish.id)).ok).toBe(true);
    expect(wishes.all()).toEqual([]);
  });
});

describe("buyWish", () => {
  const buy = (wishId: WishId, changes: Partial<Parameters<typeof wishlist.buyWish>[1]> = {}) =>
    wishlist.buyWish(jack, {
      wishId,
      printingId: "m3c",
      finish: "nonfoil",
      quantity: 1,
      expectedUnitPrice: Cents.of(2384),
      ...changes,
    });
  const spent = () =>
    wallet.services.wallets
      .entriesFor(jack.userId)
      .filter((entry) => entry.kind === "purchase_single");
  const balance = () =>
    wallet.services.wallets.entriesFor(jack.userId).reduce((sum, entry) => sum + entry.amount, 0);

  it("buys the missing copy through the store and removes the fulfilled wish (rules 6, 8)", async () => {
    const wish = await added();
    const result = await buy(wish.id);
    expect(result).toMatchObject({
      ok: true,
      value: { isFulfilled: true, receipt: { total: 2384 } },
    });
    expect(collection.quantity(jack.userId, "m3c")).toBe(1);
    expect(balance()).toBe(5000 - 2384);
    expect(wishes.all()).toEqual([]);
  });

  it("keeps the wish after buying some of the copies, and counts copies you own", async () => {
    const wish = await added(ANY, { ...ONE, quantity: 3 });
    await collection.receive(
      jack.userId,
      [{ printingId: "dmc" as never, finish: "nonfoil", quantity: 1 }],
      {
        source: "store",
        ref: "test",
        at: now,
      },
    );
    expect(await buy(wish.id, { quantity: 3 })).toEqual(
      err({ kind: "BuyQuantityInvalid", max: 2 }),
    );
    expect(await buy(wish.id)).toMatchObject({ ok: true, value: { isFulfilled: false } });
    expect(wishes.all()).toHaveLength(1);
  });

  it("refuses when the price has gone up since the page loaded, and nothing moves (rule 7)", async () => {
    const wish = await added();
    prices["m3c/nonfoil"] = { ...prices["m3c/nonfoil"], price: Cents.of(2500) };
    expect(await buy(wish.id)).toEqual(err({ kind: "PricesChanged", total: 2500 }));
    expect(spent()).toEqual([]);
    expect(wishes.all()).toHaveLength(1);
  });

  it("buys at a lower price than the page showed", async () => {
    const wish = await added();
    prices["m3c/nonfoil"] = { ...prices["m3c/nonfoil"], price: Cents.of(2000) };
    expect(await buy(wish.id)).toMatchObject({ ok: true, value: { receipt: { total: 2000 } } });
  });

  it("keeps the wish when the wallet can't pay", async () => {
    const wish = await added(ANY, { ...ONE, quantity: 3 });
    expect(await buy(wish.id, { quantity: 3 })).toEqual(
      err({ kind: "InsufficientFunds", balance: Cents.of(5000), required: Cents.of(3 * 2384) }),
    );
    expect(wishes.all()).toHaveLength(1);
  });

  it("refuses a printing the wish doesn't ask for, a wish you own already, someone else's", async () => {
    const wish = await added();
    expect(await buy(wish.id, { finish: "foil", expectedUnitPrice: Cents.of(4100) })).toEqual(
      err({ kind: "DoesNotFit" }),
    );
    expect(await buy(wish.id, { printingId: "bolt" })).toEqual(err({ kind: "DoesNotFit" }));
    expect(
      await wishlist.buyWish(bob, {
        wishId: wish.id,
        printingId: "m3c",
        finish: "nonfoil",
        quantity: 1,
        expectedUnitPrice: Cents.of(2384),
      }),
    ).toEqual(err({ kind: "WishNotFound" }));
    await collection.receive(
      jack.userId,
      [{ printingId: "m3c" as never, finish: "foil", quantity: 1 }],
      {
        source: "store",
        ref: "test",
        at: now,
      },
    );
    expect(await buy(wish.id)).toEqual(err({ kind: "AlreadyOwned" }));
  });
});

describe("deleteWishlist", () => {
  it("deletes every wish of one player (part of a reset)", async () => {
    await added();
    await added({ kind: "exactPrinting", printingId: "m3c", finish: "foil" });
    await wishlist.addWish(bob, { request: ANY, details: ONE });
    expect(await deleteWishlist({ wishes }, jack.userId)).toBe(2);
    expect(wishes.all().map((wish) => wish.userId)).toEqual(["bob"]);
  });
});
