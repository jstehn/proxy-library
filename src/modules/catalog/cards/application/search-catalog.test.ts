import { describe, expect, it } from "vitest";
import { testActor } from "@/modules/accounts/testing/actors";
import {
  makeSearchCatalog,
  type CollectionAnswer,
  type SearchCatalogReaders,
} from "./search-catalog";

const actor = testActor();
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
  makeSearchCatalog(readers())(actor, { search: "x", where, page: 1, oneRowPerCard: true });

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

  it("sorts merged owned cards by price_desc, added_desc, and mv and forwards addedSince", async () => {
    const seen: unknown[] = [];
    const earlier = new Date("2026-11-20T00:00:00Z");
    const later = new Date("2026-11-24T00:00:00Z");
    const customReaders = readers({
      collection: async (_actor, options) => {
        seen.push(options);
        return {
          rows: [
            {
              printingId: "p-b",
              finish: "nonfoil",
              quantity: 1,
              price: 100,
              manaValue: 5,
              lastAcquiredAt: earlier,
            },
          ],
          notes: [],
          totals: { different: 1, copies: 1 },
          pageCount: 1,
        };
      },
      realCollection: async () => ({
        rows: [
          {
            printingId: "p-a",
            finish: "nonfoil",
            quantity: 1,
            price: 500,
            manaValue: 1,
            lastAcquiredAt: later,
          },
        ],
        notes: [],
        totals: { different: 1, copies: 1 },
        pageCount: 1,
      }),
    });
    const search = makeSearchCatalog(customReaders);
    const byPrice = await search(actor, {
      search: "",
      where: "owned",
      page: 1,
      oneRowPerCard: true,
      sort: "price_desc",
      addedSince: earlier,
    });
    expect(
      byPrice.ok && byPrice.value.kind === "owned" && byPrice.value.cards.map((card) => card.name),
    ).toEqual(["Apple", "Banana"]);
    expect(seen[0]).toEqual({ page: 1, search: "", sort: "price_desc", addedSince: earlier });

    const byAdded = await search(actor, {
      search: "",
      where: "owned",
      page: 1,
      oneRowPerCard: true,
      sort: "added_desc",
    });
    expect(
      byAdded.ok && byAdded.value.kind === "owned" && byAdded.value.cards.map((card) => card.name),
    ).toEqual(["Apple", "Banana"]);

    const byMana = await search(actor, {
      search: "",
      where: "owned",
      page: 1,
      oneRowPerCard: true,
      sort: "mv",
    });
    expect(
      byMana.ok && byMana.value.kind === "owned" && byMana.value.cards.map((card) => card.name),
    ).toEqual(["Apple", "Banana"]);
  });
});
