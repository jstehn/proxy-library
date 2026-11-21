import { describe, expect, it } from "vitest";
import {
  EMPTY_LIST,
  type CandidatePool,
  type SuggestionCard,
  type SuggestionContext,
} from "../domain/suggestion-types";
import { budgetList, budgetReplacements, deckSuggestions, similarCards } from "./suggest-cards";

// The suggestion orchestration against a fake pool: what it asks the pool for, and what it does
// with the answers. The scoring itself is tested in scoring/domain/suggest.test.ts.

const EMPTY_CONTEXT: SuggestionContext = {
  deckId: 1,
  format: "commander",
  usesRealCards: true,
  colorLimit: null,
  inDeck: [],
  countedQuantities: new Map(),
  lines: [],
  commanderOracleIds: [],
  targetBracket: null,
  bracketLines: [],
};

function card(name: string, pool: "owned" | "store", priceCents: number | null): SuggestionCard {
  return {
    oracleId: name.toLowerCase(),
    name,
    typeLine: "Artifact",
    manaCost: "{2}",
    manaValue: 2,
    roles: ["ramp"],
    themes: [],
    keywords: [],
    text: "",
    producedMana: [],
    pool,
    priceCents,
    setCode: "tst",
    collectorNumber: "1",
    finish: "nonfoil",
  } as unknown as SuggestionCard;
}

/** A pool that answers from fixed cards and remembers which questions were asked. */
function fakePool(
  overrides: Partial<CandidatePool> = {},
  cards: { owned?: SuggestionCard[]; store?: SuggestionCard[] } = {},
) {
  const asked: string[] = [];
  const ask = (name: string) => asked.push(name);
  const pool: CandidatePool = {
    context: async () => EMPTY_CONTEXT,
    comboPartners: async () => new Map(),
    owned: async () => (ask("owned"), cards.owned ?? []),
    store: async () => (ask("store"), cards.store ?? []),
    ownedAmong: async () => (ask("ownedAmong"), []),
    storeAmong: async () => (ask("storeAmong"), []),
    similarities: async () => new Map(),
    neighbours: async () => (ask("neighbours"), []),
    cardLike: async () => null,
    deckPlan: async () => ({ plan: null, pinnedOracleIds: new Set<string>() }),
    cheapestPrices: async () => [],
    ...overrides,
  };
  return { pool, asked };
}

describe("deckSuggestions", () => {
  it("is null for a deck that isn't the player's, and asks for nothing else", async () => {
    const { pool, asked } = fakePool({ context: async () => null });
    expect(await deckSuggestions(pool, 1)).toBeNull();
    expect(asked).toEqual([]);
  });

  it("asks the pool for owned and store candidates and keeps them apart", async () => {
    const { pool, asked } = fakePool(
      {},
      { owned: [card("Sol Ring", "owned", null)], store: [card("Arcane Signet", "store", 150)] },
    );
    const result = await deckSuggestions(pool, 1);
    expect(asked).toEqual(["owned", "store"]);
    expect(result?.forDeck.owned.map((suggestion) => suggestion.card.name)).toEqual(["Sol Ring"]);
    expect(result?.forDeck.store.map((suggestion) => suggestion.card.name)).toEqual([
      "Arcane Signet",
    ]);
  });
});

describe("similarCards", () => {
  it("is an empty list when the catalog doesn't know the card", async () => {
    const { pool, asked } = fakePool();
    expect(await similarCards(pool, 1, "nothing")).toEqual(EMPTY_LIST);
    expect(asked).toEqual([]);
  });

  it("looks among the card's embedding neighbours when it has any", async () => {
    const target = card("Sol Ring", "store", 100);
    const { pool, asked } = fakePool({
      cardLike: async () => target,
      neighbours: async () => [{ oracleId: "mind stone", similarity: 0.9 }],
    });
    await similarCards(pool, 1, "sol ring");
    expect(asked).toEqual(["ownedAmong", "storeAmong"]);
  });

  it("falls back to what the card is about when it has no neighbours", async () => {
    const { pool, asked } = fakePool({ cardLike: async () => card("Sol Ring", "store", 100) });
    await similarCards(pool, 1, "sol ring");
    expect(asked).toEqual(["neighbours", "owned", "store"]);
  });
});

describe("budgetList", () => {
  it("takes no more than the budget", async () => {
    const { pool } = fakePool(
      {},
      { store: [card("Arcane Signet", "store", 150), card("Mind Stone", "store", 400)] },
    );
    const list = await budgetList(pool, 1, 200);
    expect(list?.picks.map((pick) => pick.card.name)).toEqual(["Arcane Signet"]);
    expect(list?.totalCents).toBe(150);
    expect(list?.listText).toBe("1 Arcane Signet (TST) 1");
  });
});

describe("budgetReplacements", () => {
  it("has nothing to replace in a deck without spells", async () => {
    const { pool } = fakePool();
    expect(await budgetReplacements(pool, 1)).toEqual({
      cards: [],
      minPriceCents: 500,
      maxPriceCents: 200,
    });
  });
});
