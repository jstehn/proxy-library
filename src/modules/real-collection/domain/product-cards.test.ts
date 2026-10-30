import { describe, expect, it } from "vitest";
import type { SealedContent, SealedProduct } from "@/modules/catalog";
import { samplePrintingId, sampleProductId, sampleSetCode } from "../testing/fakes";
import { realProductCards, type ProductDeckList } from "./product-cards";

const card = (id: string, quantity: number, board: "commander" | "main" | "side" = "main") => ({
  printingId: samplePrintingId(id),
  finish: "nonfoil" as const,
  quantity,
  board,
});
const precon: ProductDeckList = {
  type: "Commander Deck",
  cards: [card("leader", 1, "commander"), card("sol", 1), card("plains", 10)],
};
const landPack: ProductDeckList = { type: "Bundle Land Pack", cards: [card("plains", 5)] };
const DECKS: Record<string, ProductDeckList> = {
  "SOC/Silverquill Influence": precon,
  "BLB/Land Pack": landPack,
};

const deck = (deckName: string, setCode = "SOC"): SealedContent => ({
  kind: "deck",
  setCode: sampleSetCode(setCode),
  deckName,
});
function product(id: string, name: string, contents: SealedContent[]): SealedProduct {
  return {
    id: sampleProductId(id),
    setCode: sampleSetCode("SOC"),
    name,
    category: "deck",
    subtype: null,
    releaseDate: null,
    contents,
  };
}

const bundle = product("bundle", "Bundle", [
  { kind: "pack", setCode: sampleSetCode("BLB"), boosterType: "play" },
  deck("Land Pack", "BLB"),
  { kind: "card", printingId: samplePrintingId("promo"), finish: "foil" },
  { kind: "other", name: "Spindown" },
]);
const PRODUCTS = [bundle];

function cardsOf(contents: SealedContent[], choices: number[] = []) {
  return realProductCards(
    contents,
    (id) => PRODUCTS.find((each) => each.id === id) ?? null,
    (setCode, deckName) => DECKS[`${setCode}/${deckName}`] ?? null,
    choices,
  );
}

describe("realProductCards (section 15)", () => {
  it("a precon: its whole list, every board, and a deck to make", () => {
    const result = cardsOf([
      deck("Silverquill Influence"),
      { kind: "other", name: "10 Double-sided tokens" },
    ]);
    expect(result.ok && result.value).toEqual({
      copies: [
        { printingId: "leader", finish: "nonfoil", quantity: 1 },
        { printingId: "sol", finish: "nonfoil", quantity: 1 },
        { printingId: "plains", finish: "nonfoil", quantity: 10 },
      ],
      decks: [{ name: "Silverquill Influence", type: "Commander Deck", cards: precon.cards }],
      notAdded: ["10 Double-sided tokens"],
    });
  });

  it("nested products count as many times as they're in the box; packs aren't added", () => {
    const result = cardsOf([{ kind: "sealed", productId: sampleProductId("bundle"), count: 2 }]);
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.value.copies).toEqual([
      { printingId: "plains", finish: "nonfoil", quantity: 10 },
      { printingId: "promo", finish: "foil", quantity: 2 },
    ]);
    expect(result.value.notAdded).toEqual([
      "BLB play booster",
      "Spindown",
      "BLB play booster",
      "Spindown",
    ]);
  });

  it("a 'one of these' asks which one until it's chosen", () => {
    const either: SealedContent = {
      kind: "variable",
      options: [[deck("Silverquill Influence")], [deck("Land Pack", "BLB")]],
    };
    expect(cardsOf([either])).toEqual({
      ok: false,
      error: { kind: "ChoiceNeeded", index: 0, options: ["Silverquill Influence", "Land Pack"] },
    });
    const chosen = cardsOf([either], [1]);
    expect(chosen.ok && chosen.value.copies).toEqual([
      { printingId: "plains", finish: "nonfoil", quantity: 5 },
    ]);
  });

  it("a product refers to something missing from the catalog", () => {
    expect(cardsOf([deck("Gone")])).toEqual({ ok: false, error: { kind: "ProductUnavailable" } });
    expect(cardsOf([{ kind: "sealed", productId: sampleProductId("gone"), count: 1 }])).toEqual({
      ok: false,
      error: { kind: "ProductUnavailable" },
    });
  });
});
