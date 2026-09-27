import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { inMemoryCollectionRepository } from "@/modules/collection/testing/fakes";
import { inMemoryBoosterSource } from "@/modules/packs/testing/fakes";
import { SAMPLE_BOOSTER, SAMPLE_FACTS } from "@/modules/packs/testing/recipes";
import { err, UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { ItemId, type Item } from "../domain/item";
import {
  inMemoryItemRepository,
  inMemoryProductCatalog,
  SAMPLE_DECKS,
  SAMPLE_PRODUCTS,
} from "../testing/fakes";
import { makeInventory } from "./make-inventory";
import { receiveItems } from "./receive-items";

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
const now = new Date("2026-09-27T12:00:00Z");

let items: ReturnType<typeof inMemoryItemRepository>;
let collection: ReturnType<typeof inMemoryCollectionRepository>;
let services: Parameters<typeof receiveItems>[0];
let inventory: ReturnType<typeof makeInventory>;

beforeEach(() => {
  items = inMemoryItemRepository();
  collection = inMemoryCollectionRepository();
  services = {
    items,
    collection,
    productCatalog: inMemoryProductCatalog(Object.values(SAMPLE_PRODUCTS), SAMPLE_DECKS),
    boosters: inMemoryBoosterSource([SAMPLE_BOOSTER], SAMPLE_FACTS),
  };
  let seeds = 0;
  inventory = makeInventory({
    unitOfWork: inMemoryUnitOfWork(services),
    clock: fixedClock(now),
    seeds: { newSeed: () => `seed-${++seeds}` },
  });
});

async function give(product: keyof typeof SAMPLE_PRODUCTS, quantity = 1): Promise<Item[]> {
  const result = await receiveItems(services, {
    ownerId: jack.userId,
    productId: SAMPLE_PRODUCTS[product].id,
    quantity,
    origin: "purchase",
    now,
  });
  if (!result.ok) throw new Error("could not give items");
  return result.value;
}

const owned = (printingId: string, finish: "nonfoil" | "foil" = "nonfoil") =>
  collection.quantity(jack.userId, printingId, finish);

describe("receiveItems", () => {
  it("gives one item per copy, collapsing a single pack into a pack", async () => {
    const received = await give("pack", 3);
    expect(received.map((item) => item.content.kind)).toEqual(["pack", "pack", "pack"]);
    expect(received.every((item) => item.status === "unopened")).toBe(true);
  });
});

describe("openItem", () => {
  it("opens a pack: 14 cards into the collection, logged, with the seed stored (rules 6, 7)", async () => {
    const [pack] = await give("pack");
    const result = await inventory.openItem(jack, pack.id);
    if (!result.ok || result.value.kind !== "pack") throw new Error("expected a pack");

    expect(result.value.pack.cards).toHaveLength(14);
    expect(result.value.pack.seed).toBe("seed-1");
    const stored = items.openingOf(pack.id);
    expect(stored).toMatchObject({ kind: "pack", seed: "seed-1" });
    expect(collection.log).toEqual([
      expect.objectContaining({ source: "pack", ref: `item:${pack.id}`, at: now }),
    ]);
    const total = collection.log[0].gains.reduce((sum, gain) => sum + gain.quantity, 0);
    expect(total).toBe(14);
  });

  it("refuses to open the same pack twice", async () => {
    const [pack] = await give("pack");
    await inventory.openItem(jack, pack.id);
    expect(await inventory.openItem(jack, pack.id)).toEqual(err({ kind: "AlreadyOpened" }));
  });

  it("won't open someone else's item", async () => {
    const [pack] = await give("pack");
    expect(await inventory.openItem(actor("mallory"), pack.id)).toEqual(
      err({ kind: "ItemNotFound" }),
    );
    expect(await inventory.openItem(jack, ItemId.of(999))).toEqual(err({ kind: "ItemNotFound" }));
  });

  it("unpacks a bundle one level: packs and a deck to open later, the promo card now", async () => {
    const [bundle] = await give("bundle");
    const result = await inventory.openItem(jack, bundle.id);
    if (!result.ok || result.value.kind !== "product") throw new Error("expected a product");

    expect(result.value.children.map((child) => child.content.kind)).toEqual([
      "pack",
      "pack",
      "deck",
    ]);
    expect(result.value.children.every((child) => child.parentId === bundle.id)).toBe(true);
    expect(result.value.extras).toEqual(["Spindown"]);
    expect(owned("m-1", "foil")).toBe(1);
  });

  it("opens a deck into its deck list's cards", async () => {
    const [bundle] = await give("bundle");
    const unpacked = await inventory.openItem(jack, bundle.id);
    if (!unpacked.ok || unpacked.value.kind !== "product") throw new Error("expected a product");
    const deck = unpacked.value.children[2];

    await inventory.openItem(jack, deck.id);
    expect(owned("l-forest")).toBe(5);
    expect(owned("l-island")).toBe(5);
  });

  it("reports a pack whose recipe has gone, and changes nothing", async () => {
    const [pack] = await give("pack");
    services.boosters = inMemoryBoosterSource([], SAMPLE_FACTS);
    expect(await inventory.openItem(jack, pack.id)).toEqual(err({ kind: "BoosterUnavailable" }));
    expect(collection.log).toEqual([]);
  });
});

describe("openAll", () => {
  it("opens a box and every pack inside it, parents first", async () => {
    const [box] = await give("box");
    const result = await inventory.openAll(jack, [box.id]);
    if (!result.ok) throw new Error("expected openings");

    expect(result.value.map((opening) => opening.kind)).toEqual([
      "product",
      "pack",
      "pack",
      "pack",
    ]);
    expect(items.itemsOf(jack.userId).every((item) => item.status === "opened")).toBe(true);
    const cards = collection.log.flatMap((entry) => entry.gains);
    expect(cards.reduce((sum, gain) => sum + gain.quantity, 0)).toBe(42); // 3 packs × 14
  });

  it("opens several packs at once, each with its own seed", async () => {
    const packs = await give("pack", 3);
    const result = await inventory.openAll(
      jack,
      packs.map((pack) => pack.id),
    );
    if (!result.ok) throw new Error("expected openings");
    const seeds = result.value.map((opening) => (opening.kind === "pack" ? opening.pack.seed : ""));
    expect(new Set(seeds).size).toBe(3);
  });
});
