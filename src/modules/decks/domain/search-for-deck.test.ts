import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  mergeHits,
  queryHint,
  rankFound,
  searchForDeckResult,
  type FoundCard,
  type MergedCard,
  type QueryHits,
} from "./search-for-deck";

const card = (name: string, overrides: Partial<FoundCard> = {}): FoundCard => ({
  oracleId: `oracle-${name}`,
  printingId: `printing-${name}`,
  name,
  manaCost: null,
  manaValue: 2,
  typeLine: "Creature",
  text: "",
  isGameChanger: false,
  roleTags: [],
  themes: [],
  owned: 0,
  priceCents: 100,
  ...overrides,
});

const hits = (synergy: string, cards: FoundCard[], found = cards.length): QueryHits => ({
  query: { synergy, search: "x" },
  found,
  cards,
  notes: [],
});

describe("mergeHits", () => {
  it("lists every synergy a card matched, once each, in query order", () => {
    const merged = mergeHits([
      hits("Treasure makers", [card("Smothering Tithe"), card("Pitiless Plunderer")]),
      hits("Sacrifice payoffs", [card("Pitiless Plunderer")]),
      hits("Treasure makers", [card("Pitiless Plunderer")]),
    ]);
    expect(merged.map((each) => [each.name, each.synergies])).toEqual([
      ["Smothering Tithe", ["Treasure makers"]],
      ["Pitiless Plunderer", ["Treasure makers", "Sacrifice payoffs"]],
    ]);
  });

  it("keeps your copy over the store's offer of the same card", () => {
    const merged = mergeHits([
      hits("a", [card("Bolt", { owned: 0, printingId: "store" })]),
      hits("b", [card("Bolt", { owned: 2, printingId: "mine" })]),
    ]);
    expect(merged[0]).toMatchObject({ owned: 2, printingId: "mine" });
  });
});

describe("rankFound (rule 13)", () => {
  const merged = (name: string, synergies: number, owned: number, priceCents: number | null) =>
    ({
      ...card(name, { owned, priceCents }),
      synergies: Array.from({ length: synergies }, (_, index) => `s${index}`),
    }) satisfies MergedCard;

  it("puts more synergies first, then owned, then cheaper, then by name", () => {
    const ranked = rankFound([
      merged("Cheap store", 1, 0, 50),
      merged("Owned", 1, 1, 900),
      merged("Two synergies", 2, 0, 5000),
      merged("Not for sale", 1, 0, null),
      merged("Also cheap", 1, 0, 50),
    ]);
    expect(ranked.map((each) => each.name)).toEqual([
      "Two synergies",
      "Owned",
      "Also cheap",
      "Cheap store",
      "Not for sale",
    ]);
  });

  it("only reorders: the same cards, whatever the input order", () => {
    const arbitraryCard = fc
      .record({
        name: fc.string({ minLength: 1, maxLength: 6 }),
        synergies: fc.integer({ min: 1, max: 4 }),
        owned: fc.integer({ min: 0, max: 3 }),
        price: fc.option(fc.integer({ min: 0, max: 10_000 })),
      })
      .map(({ name, synergies, owned, price }) => merged(name, synergies, owned, price));
    fc.assert(
      fc.property(fc.array(arbitraryCard, { maxLength: 30 }), (cards) => {
        const ranked = rankFound(cards);
        expect([...ranked].sort(byOracle)).toEqual([...cards].sort(byOracle));
        expect(rankFound([...cards].reverse()).map((each) => each.oracleId)).toEqual(
          ranked.map((each) => each.oracleId),
        );
      }),
    );
  });
});

function byOracle(a: MergedCard, b: MergedCard): number {
  return (
    a.oracleId.localeCompare(b.oracleId) ||
    a.synergies.length - b.synergies.length ||
    a.owned - b.owned ||
    (a.priceCents ?? -1) - (b.priceCents ?? -1)
  );
}

describe("queryHint (rule 14)", () => {
  it("says to loosen a query that found nothing, and mentions ignored parts", () => {
    expect(queryHint(hits("a", []), 20)).toMatch(/^Found nothing\. Loosen it/);
    expect(queryHint({ ...hits("a", []), notes: ["x"] }, 20)).toContain("see notes");
  });

  it("says to narrow a query that hit the cap, and nothing otherwise", () => {
    expect(queryHint(hits("a", [card("A")], 75), 20)).toBe(
      "Found 75; showing 20. Narrow it with t:, mv<=, tag:, theme: or a longer phrase.",
    );
    expect(queryHint(hits("a", [card("A")]), 20)).toBeNull();
  });
});

describe("searchForDeckResult", () => {
  it("reports each query and returns the merged, ranked cards", () => {
    const result = searchForDeckResult(
      [hits("a", [card("A"), card("B")], 30), hits("b", [card("B")])],
      2,
    );
    expect(result.queries.map((each) => [each.found, each.shown, each.capped])).toEqual([
      [30, 2, true],
      [1, 1, false],
    ]);
    expect(result.cards.map((each) => each.name)).toEqual(["B", "A"]);
  });
});
