import { testActor } from "@/modules/accounts/testing/actors";
import { beforeEach, describe, expect, it } from "vitest";
import { inMemoryEventRecorder } from "@/modules/activity/testing/fakes";
import { PrintingId } from "@/modules/catalog";
import { inMemoryCollectionRepository } from "@/modules/collection/game/testing/fakes";
import { inMemoryItemRepository, inMemoryProductCatalog } from "@/modules/inventory/testing/fakes";
import { inMemoryBoosterSource } from "@/modules/packs/testing/fakes";
import { inMemoryWalletServices } from "@/modules/wallet/testing/fakes";
import { Cents, err } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import {
  inMemoryMarketPrices,
  inMemoryPriceList,
  inMemoryProductValues,
  inMemoryStoreLedger,
  inMemoryStoreSettings,
} from "../testing/fakes";
import { makeStore } from "./make-store";

const jack = testActor({ name: "jack" });
const admin = testActor({ name: "admin", isAdmin: true });
const now = new Date("2026-01-07T10:00:00Z");
const bolt = PrintingId.of("bolt");
const tarmo = PrintingId.of("tarmo");
const penny = PrintingId.of("penny");
const unpriced = PrintingId.of("unpriced");

let wallet: ReturnType<typeof inMemoryWalletServices>;
let collection: ReturnType<typeof inMemoryCollectionRepository>;
let storeLedger: ReturnType<typeof inMemoryStoreLedger>;
let settings: ReturnType<typeof inMemoryStoreSettings>;
let store: ReturnType<typeof makeStore>;

beforeEach(async () => {
  wallet = inMemoryWalletServices(["jack", "admin"]);
  collection = inMemoryCollectionRepository();
  storeLedger = inMemoryStoreLedger();
  settings = inMemoryStoreSettings(); // default 50% (5000 bps)
  const services = {
    ...wallet.services,
    items: inMemoryItemRepository(),
    productCatalog: inMemoryProductCatalog([]),
    boosters: inMemoryBoosterSource([], new Map()),
    collection,
    priceList: inMemoryPriceList([]),
    storeLedger,
    marketPrices: inMemoryMarketPrices({
      "bolt/nonfoil": { price: Cents.of(200), day: "2026-01-06", isSetEnabled: true },
      "tarmo/nonfoil": { price: Cents.of(1000), day: "2026-01-06", isSetEnabled: true },
      "penny/nonfoil": { price: Cents.of(0), day: "2026-01-06", isSetEnabled: true },
    }),
    storeSettings: settings,
    productValues: inMemoryProductValues(),
    events: inMemoryEventRecorder(),
  };
  store = makeStore({ unitOfWork: inMemoryUnitOfWork(services), clock: fixedClock(now) });

  await collection.receive(
    jack.userId,
    [
      { printingId: bolt, finish: "nonfoil", quantity: 4 },
      { printingId: tarmo, finish: "nonfoil", quantity: 2 },
      { printingId: penny, finish: "nonfoil", quantity: 3 },
    ],
    { source: "store", ref: "seed", at: now },
  );
});

describe("sellList", () => {
  it("sells all staged lines atomically and credits the wallet", async () => {
    // At 50%: bolt = $1.00 each (x3 = $3.00), tarmo = $5.00 each (x1 = $5.00) -> $8.00
    const result = await store.sellList(jack, {
      lines: [
        { printingId: bolt, finish: "nonfoil", quantity: 3 },
        { printingId: tarmo, finish: "nonfoil", quantity: 1 },
      ],
      expectedTotal: Cents.of(800),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cards).toBe(4);
    expect(result.value.total).toBe(Cents.of(800));
    expect(result.value.transactionIds).toHaveLength(2);

    expect(collection.quantity(jack.userId, bolt)).toBe(1);
    expect(collection.quantity(jack.userId, tarmo)).toBe(1);
    const sellbacks = wallet.services.wallets
      .entriesFor(jack.userId)
      .filter((entry) => entry.kind === "sellback");
    expect(sellbacks).toHaveLength(1);
    expect(sellbacks[0].amount).toBe(Cents.of(800));
  });

  it("refuses and leaves collection untouched if payout dropped below expectedTotal", async () => {
    const result = await store.sellList(jack, {
      lines: [{ printingId: bolt, finish: "nonfoil", quantity: 2 }],
      expectedTotal: Cents.of(250), // actual is 200
    });

    expect(result).toEqual(err({ kind: "PricesChanged", total: Cents.of(200) }));
    expect(collection.quantity(jack.userId, bolt)).toBe(4);
  });

  it("rolls back all lines if any card lacks enough copies", async () => {
    const startBalance = await wallet.services.wallets.balance(jack.userId);
    const result = await store.sellList(jack, {
      lines: [
        { printingId: bolt, finish: "nonfoil", quantity: 2 },
        { printingId: tarmo, finish: "nonfoil", quantity: 5 }, // only owns 2
      ],
      expectedTotal: Cents.of(0),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotEnoughCopies");
    expect(collection.quantity(jack.userId, bolt)).toBe(4);
    expect(collection.quantity(jack.userId, tarmo)).toBe(2);
    expect(await wallet.services.wallets.balance(jack.userId)).toBe(startBalance);
  });

  it("rejects empty list, not-buying store, unpriced cards, and zero-payout cards", async () => {
    expect(await store.sellList(jack, { lines: [], expectedTotal: Cents.zero })).toEqual(
      err({ kind: "ListEmpty" }),
    );

    expect(
      await store.sellList(jack, {
        lines: [{ printingId: unpriced, finish: "nonfoil", quantity: 1 }],
        expectedTotal: Cents.zero,
      }),
    ).toEqual(err({ kind: "NoPrice" }));

    expect(
      await store.sellList(jack, {
        lines: [{ printingId: penny, finish: "nonfoil", quantity: 1 }],
        expectedTotal: Cents.zero,
      }),
    ).toEqual(err({ kind: "WorthNothing" }));

    await store.setBuylistRate(admin, 0);
    expect(
      await store.sellList(jack, {
        lines: [{ printingId: bolt, finish: "nonfoil", quantity: 1 }],
        expectedTotal: Cents.zero,
      }),
    ).toEqual(err({ kind: "NotBuying" }));
  });
});
