import { describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { err, ok } from "@/shared/kernel";
import { WishId } from "../domain/wish";
import { makeAddWishes, makeRemoveWishes, type WishToAdd } from "./wishlist-tools";

const actor = { userId: "1" } as unknown as Actor;
const wish = (overrides: Partial<WishToAdd> = {}): WishToAdd => ({
  card: "Sol Ring",
  printing: "any",
  finish: "nonfoil",
  quantity: 1,
  note: "",
  ...overrides,
});

describe("addWishes", () => {
  const found = async (name: string) =>
    name === "Nope" ? null : { printingId: `p-${name}`, name };

  it("reports a card that isn't in the catalog and carries on with the rest", async () => {
    const addWishes = makeAddWishes({
      findCard: found,
      addWish: async () => ok({ wish: { id: 5 }, isNew: true } as never),
    });
    const result = await addWishes({ actor, wishes: [wish({ card: "Nope" }), wish()] });
    expect(result.ok && result.value).toEqual({
      added: [{ wishId: 5, card: "Sol Ring", isNew: true }],
      errors: [{ card: "Nope", kind: "CardNotFound", message: "Not in catalog." }],
    });
  });

  it("refuses etched for any printing and cheapest for an exact one, without saving", async () => {
    let saved = 0;
    const addWishes = makeAddWishes({
      findCard: found,
      addWish: async () => {
        saved += 1;
        return ok({ wish: { id: 1 }, isNew: true } as never);
      },
    });
    const result = await addWishes({
      actor,
      wishes: [wish({ finish: "etched" }), wish({ printing: "exact", finish: "cheapest" })],
    });
    expect(saved).toBe(0);
    expect(result.ok && result.value.errors.map((error) => error.kind)).toEqual([
      "InvalidWish",
      "InvalidWish",
    ]);
  });

  it("says in words why the wishlist refused a wish", async () => {
    const addWishes = makeAddWishes({
      findCard: found,
      addWish: async () => err({ kind: "WishlistFull", max: 200 }),
    });
    const result = await addWishes({ actor, wishes: [wish()] });
    expect(result.ok && result.value.errors[0]).toMatchObject({
      kind: "WishlistFull",
      message: "The wishlist holds at most 200 wishes.",
    });
  });
});

describe("removeWishes", () => {
  it("separates the wishes removed from those that weren't there", async () => {
    const removeWishes = makeRemoveWishes(
      { removeWish: async (_actor, id) => (id === WishId.of(1) ? ok() : err({ kind: "x" })) },
      (value) => WishId.of(value),
    );
    const result = await removeWishes({ actor, wishIds: [1, 2] });
    expect(result.ok && result.value).toEqual({ removed: [1], notFound: [2] });
  });
});
