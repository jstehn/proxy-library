import { describe, expect, it } from "vitest";
import { testActor } from "@/modules/accounts/testing/actors";
import { makeCardLookup, type CardLookupReaders } from "./card-lookup";

const actor = testActor();
const card = {
  oracleId: "o1",
  printingId: "p1",
  name: "Sol Ring",
  typeLine: "Artifact",
  manaCost: "{1}",
  colorIdentity: [],
};

function readers(overrides: Partial<CardLookupReaders> = {}): CardLookupReaders {
  return {
    find: async (query) => (query === "Sol Ring" ? card : null),
    detail: async () => ({
      card: { faces: [{ text: "Add two." }] },
      setCode: "C21",
      setName: "C21",
    }),
    history: async () => ({
      nonfoil: [
        { day: "2026-01-01", price: 100 },
        { day: "2026-01-02", price: 300 },
        { day: "2026-01-03", price: 200 },
      ],
    }),
    ownedOfPrinting: async () => ({ nonfoil: 1 }),
    gameCopies: async () => [
      { printingId: "p1", setCode: "C21", collectorNumber: "1", finish: "nonfoil", quantity: 2 },
    ],
    realCopies: async () => [
      { printingId: "p2", setCode: "LEA", collectorNumber: "2", finish: "nonfoil", quantity: 1 },
    ],
    decksUsing: async () => [{ id: 7, name: "Artifacts", quantity: 1 }],
    wishes: async () => [],
    storePrintings: async () => [],
    ...overrides,
  };
}

describe("lookUpCards", () => {
  it("says which names weren't found and keeps the order asked", async () => {
    const result = await makeCardLookup(readers())(actor, { queries: ["Nope", "Sol Ring"] });
    expect(result.ok && result.value.map((entry) => [entry.query, entry.found])).toEqual([
      ["Nope", false],
      ["Sol Ring", true],
    ]);
  });

  it("totals game and real copies and lists each printing with its source", async () => {
    const result = await makeCardLookup(readers())(actor, { queries: ["Sol Ring"] });
    const [entry] = result.ok ? result.value : [];
    expect(entry?.found && entry.owned).toMatchObject({ total: 3, game: 2, real: 1 });
    expect(entry?.found && entry.owned.printings.map((copy) => copy.source)).toEqual([
      "game",
      "real",
    ]);
  });

  it("summarises a price trend: first, latest, low and high", async () => {
    const result = await makeCardLookup(readers())(actor, { queries: ["Sol Ring"] });
    const [entry] = result.ok ? result.value : [];
    expect(entry?.found && entry.priceTrend[0]).toEqual({
      finish: "nonfoil",
      first: { day: "2026-01-01", price: 100 },
      latest: { day: "2026-01-03", price: 200 },
      low: 100,
      high: 300,
    });
  });

  it("copes with a card that has no price history", async () => {
    const result = await makeCardLookup(readers({ history: async () => ({ foil: [] }) }))(actor, {
      queries: ["Sol Ring"],
    });
    const [entry] = result.ok ? result.value : [];
    expect(entry?.found && entry.priceTrend[0]).toMatchObject({
      first: null,
      latest: null,
      low: null,
      high: null,
    });
  });
});
