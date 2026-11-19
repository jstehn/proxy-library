import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import {
  makeSearchCatalog,
  type CollectionAnswer,
  type SearchCatalogReaders,
} from "./search-catalog";

const userId = UserId.of("1");
const answer = (printingId: string, quantity: number, price: number | null): CollectionAnswer => ({
  rows: [{ printingId, finish: "nonfoil", quantity, price }],
  notes: [],
  totals: { different: 1, copies: quantity },
  pageCount: 1,
});
const facts = (name: string, prices: Record<string, number | undefined> = {}) => ({
  name,
  setCode: "TST",
  collectorNumber: "1",
  rarity: "common",
  faces: [{ text: `${name} text` }],
  prices,
});

function readers(overrides: Partial<SearchCatalogReaders> = {}): SearchCatalogReaders {
  return {
    collection: async () => answer("p-b", 2, 100),
    realCollection: async () => answer("p-a", 1, null),
    store: async () => ({ printingIds: ["p-b", "gone"], notes: ["n"], total: 2, pageCount: 1 }),
    printings: async () =>
      new Map([
        ["p-a", facts("Apple")],
        ["p-b", facts("Banana", { nonfoil: 300, foil: 200, etched: undefined })],
      ]),
    ...overrides,
  };
}
const ask = (where: "owned" | "game" | "real" | "store") =>
  makeSearchCatalog(readers())({ userId, search: "x", where, page: 1, oneRowPerCard: true });

describe("searchCatalog", () => {
  it("puts game and real copies together, by name, and says which is which", async () => {
    const result = await ask("owned");
    expect(
      result.ok && result.value.kind === "owned" && result.value.cards.map((c) => c.name),
    ).toEqual(["Apple", "Banana"]);
    expect(
      result.ok && result.value.kind === "owned" && result.value.cards.map((c) => c.source),
    ).toEqual(["real", "game"]);
    expect(result.ok && result.value.kind === "owned" && result.value.totals).toEqual({
      cards: 2,
      copies: 3,
    });
  });

  it("reads only the collection asked for", async () => {
    const game = await ask("game");
    const real = await ask("real");
    expect(game.ok && game.value.kind === "owned" && game.value.cards).toHaveLength(1);
    expect(real.ok && real.value.kind === "owned" && real.value.cards[0]?.source).toBe("real");
  });

  it("names store cards with their cheapest finish, dropping printings that vanished", async () => {
    const result = await ask("store");
    expect(result.ok && result.value.kind === "store" && result.value.cards).toMatchObject([
      { name: "Banana", cheapest: 200 },
    ]);
  });
});
