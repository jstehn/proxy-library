import { describe, expect, it } from "vitest";
import { makeRulesLookup, type RulesLookupReaders } from "./rules-lookup";

const cards = new Map([
  [
    "Mortuary",
    { name: "Mortuary Mire", scryfallId: "s1", text: "At the beginning of your end step, draw." },
  ],
  [
    "Citadel",
    {
      name: "Bolas's Citadel",
      scryfallId: "s2",
      text: "At the beginning of your end step, lose life.",
    },
  ],
]);

const readers: RulesLookupReaders = {
  findCard: async (query) => cards.get(query) ?? null,
  fetchRulings: async (target) => {
    if (target.name === "Broken") throw new Error("offline");
    return {
      name: target.name,
      sourceUrl: "u",
      fetchedAt: "t",
      cached: false,
      rulings: [{ publishedAt: "2020-01-01", source: "wotc", comment: "ok" }],
    };
  },
  searchRules: async () => ({ crVersion: "1", hits: [] }),
};

describe("rulesLookup", () => {
  const lookup = makeRulesLookup(readers);

  it("gives a card's rulings under the catalog's name", async () => {
    const result = await lookup.rulingsForCard("Mortuary");
    expect(result.ok && result.value).toMatchObject({ found: true, name: "Mortuary Mire" });
  });

  it("says when the catalog lacks the card", async () => {
    expect(await lookup.rulingsForCard("Nope")).toEqual({
      ok: false,
      error: { kind: "CardNotFound", query: "Nope" },
    });
  });

  it("finds the rules two cards share", async () => {
    const result = await lookup.interactionsOf(["Mortuary", "Citadel"]);
    expect(result.cards.map((card) => card.name)).toEqual(["Mortuary Mire", "Bolas's Citadel"]);
    expect(result.sharedRules.length).toBeGreaterThan(0);
  });

  it("still answers when the rulings can't be fetched", async () => {
    const offline = makeRulesLookup({
      ...readers,
      fetchRulings: async () => {
        throw new Error("offline");
      },
    });
    const result = await offline.interactionsOf(["Mortuary", "Citadel"]);
    expect(result.cards.every((card) => card.rulings.length === 0)).toBe(true);
    expect(result.cards[0]?.relatedRules.length).toBeGreaterThan(0);
  });
});
