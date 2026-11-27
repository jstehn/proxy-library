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

  it("loads distinct set codes only when includeSets is requested", async () => {
    const withSets = await makeCardLookup(readers({ sets: async () => ["CMM", "FDN", "RAV"] }))(
      actor,
      { queries: ["Sol Ring"], includeSets: true },
    );
    const [entry] = withSets.ok ? withSets.value : [];
    expect(entry?.found && entry.sets).toEqual(["CMM", "FDN", "RAV"]);

    const withoutSets = await makeCardLookup(readers({ sets: async () => ["CMM"] }))(actor, {
      queries: ["Sol Ring"],
    });
    const [plain] = withoutSets.ok ? withoutSets.value : [];
    expect(plain?.found && plain.sets).toBeUndefined();
  });

  it("uses findMany and decksUsingMany when provided and preserves query order", async () => {
    const secondCard = {
      oracleId: "o2",
      printingId: "p2",
      name: "Arcane Signet",
      typeLine: "Artifact",
      manaCost: "{2}",
      colorIdentity: [],
    };
    let findCalls = 0;
    let decksCalls = 0;
    let findManyArgs: readonly string[] = [];
    let decksManyArgs: readonly string[] = [];

    const result = await makeCardLookup(
      readers({
        find: async () => {
          findCalls += 1;
          return null;
        },
        findMany: async (queries) => {
          findManyArgs = queries;
          return new Map([
            ["Sol Ring", card],
            ["Arcane Signet", secondCard],
          ]);
        },
        decksUsing: async () => {
          decksCalls += 1;
          return [];
        },
        decksUsingMany: async (_actor, printingIds) => {
          decksManyArgs = printingIds;
          return new Map([["p2", [{ id: 9, name: "Ramp", quantity: 1 }]]]);
        },
      }),
    )(actor, { queries: ["Sol Ring", "Missing", "Arcane Signet"] });

    expect(findCalls).toBe(0);
    expect(decksCalls).toBe(0);
    expect(findManyArgs).toEqual(["Sol Ring", "Missing", "Arcane Signet"]);
    expect(decksManyArgs).toEqual(["p1", "p2"]);
    expect(
      result.ok &&
        result.value.map((entry) =>
          entry.found
            ? [entry.query, entry.card.name, entry.decksUsing.map((deck) => deck.name)]
            : [entry.query, false],
        ),
    ).toEqual([
      ["Sol Ring", "Sol Ring", []],
      ["Missing", false],
      ["Arcane Signet", "Arcane Signet", ["Ramp"]],
    ]);
  });

  it("skips history, storePrintings, and ownedOfPrinting when their flags are false", async () => {
    let historyCalls = 0;
    let storeCalls = 0;
    let ownedPrintingCalls = 0;

    const result = await makeCardLookup(
      readers({
        history: async () => {
          historyCalls += 1;
          return {};
        },
        storePrintings: async () => {
          storeCalls += 1;
          return [];
        },
        ownedOfPrinting: async () => {
          ownedPrintingCalls += 1;
          return { nonfoil: 1 };
        },
      }),
    )(actor, {
      queries: ["Sol Ring"],
      includeHistory: false,
      includeStorePrintings: false,
      includeOwnedOfPrinting: false,
    });

    expect(historyCalls).toBe(0);
    expect(storeCalls).toBe(0);
    expect(ownedPrintingCalls).toBe(0);
    const [entry] = result.ok ? result.value : [];
    expect(entry?.found && entry).toMatchObject({
      priceTrend: [],
      printingsForSale: [],
      ownedOfThisPrinting: {},
    });
  });
});
