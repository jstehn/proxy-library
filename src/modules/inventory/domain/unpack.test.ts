import { describe, expect, it } from "vitest";
import { seededRng, UserId } from "@/shared/kernel";
import { SAMPLE_PRODUCTS } from "../testing/fakes";
import { itemForProduct, ItemId, openTransition, type Item } from "./item";
import { nestedProductIds, unpack } from "./unpack";

const products = (id: string) =>
  Object.values(SAMPLE_PRODUCTS).find((product) => product.id === id) ?? null;

describe("itemForProduct (collapsing)", () => {
  it("turns a product that is exactly one pack into a pack", () => {
    expect(itemForProduct(SAMPLE_PRODUCTS.pack)).toEqual({
      content: { kind: "pack", setCode: "TST", boosterType: "play" },
      name: "Test Play Booster Pack",
      productId: "pack",
    });
  });

  it("keeps anything else as a product to unpack", () => {
    expect(itemForProduct(SAMPLE_PRODUCTS.box).content).toEqual({
      kind: "product",
      productId: "box",
    });
  });
});

describe("unpack (Composite)", () => {
  it("unpacks a box into its packs", () => {
    const plan = unpack(SAMPLE_PRODUCTS.box.contents, products, seededRng("x"));
    expect(plan?.items.map((item) => item.content.kind)).toEqual(["pack", "pack", "pack"]);
    expect(plan?.cards).toEqual([]);
  });

  it("unpacks a bundle into packs, a deck, a loose card and extras", () => {
    const plan = unpack(SAMPLE_PRODUCTS.bundle.contents, products, seededRng("x"));
    expect(plan?.items.map((item) => item.name)).toEqual([
      "Test Play Booster Pack",
      "Test Play Booster Pack",
      "Land Pack",
    ]);
    expect(plan?.cards).toEqual([{ printingId: "m-1", finish: "foil", quantity: 1 }]);
    expect(plan?.extras).toEqual(["Spindown"]);
  });

  it("picks one option of a variable product, the same one for the same seed", () => {
    const decks = (seed: string) =>
      unpack(SAMPLE_PRODUCTS.kit.contents, products, seededRng(seed))?.items.map(
        (item) => item.name,
      );
    expect(decks("a")).toEqual(decks("a"));
    const seen = new Set(Array.from({ length: 40 }, (_, index) => decks(`seed-${index}`)?.join()));
    expect(seen).toEqual(new Set(["Land Pack", "Other Deck"]));
  });

  it("gives up if a nested product is missing from the catalog", () => {
    expect(unpack(SAMPLE_PRODUCTS.box.contents, () => null, seededRng("x"))).toBeNull();
  });

  it("finds nested products, including inside variable options", () => {
    expect(nestedProductIds(SAMPLE_PRODUCTS.bundle.contents)).toEqual(["pack"]);
    expect(
      nestedProductIds([{ kind: "variable", options: [[...SAMPLE_PRODUCTS.box.contents]] }]),
    ).toEqual(["pack"]);
  });
});

describe("openTransition (rule 5)", () => {
  const jack = UserId.of("jack");
  const now = new Date("2026-09-27T12:00:00Z");
  const item: Item = {
    id: ItemId.of(1),
    ownerId: jack,
    content: { kind: "product", productId: SAMPLE_PRODUCTS.box.id },
    name: "Box",
    productId: SAMPLE_PRODUCTS.box.id,
    parentId: null,
    status: "unopened",
    origin: "purchase",
    acquiredAt: now,
    openedAt: null,
  };

  it("opens an unopened item its owner holds", () => {
    const result = openTransition(item, jack, now);
    expect(result.ok && result.value).toMatchObject({ status: "opened", openedAt: now });
  });

  it("refuses to open twice", () => {
    const opened = { ...item, status: "opened" as const, openedAt: now };
    expect(openTransition(opened, jack, now)).toEqual({
      ok: false,
      error: { kind: "AlreadyOpened" },
    });
  });

  it("treats someone else's item exactly like a missing one", () => {
    const missing = openTransition(null, jack, now);
    expect(openTransition(item, UserId.of("mallory"), now)).toEqual(missing);
  });
});
