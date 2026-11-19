import { describe, expect, it } from "vitest";
import { EMPTY_DECK_PROFILE } from "../domain/deck-profile";
import type { Suggestion, SuggestionList } from "../domain/suggestion-types";
import { makeFindReplacements, type FindReplacementsReaders } from "./find-replacements";
import { UserId } from "@/shared/kernel";

const userId = UserId.of("1");
const suggestion = (name: string) =>
  ({ card: { name }, reasons: [], rating: 50, ratingParts: [] }) as unknown as Suggestion;
const list: SuggestionList = {
  owned: [suggestion("Mortuary"), suggestion("Kept")],
  store: [suggestion("Mortuary")],
  hiddenOverTarget: 2,
};

function readers(overrides: Partial<FindReplacementsReaders> = {}): FindReplacementsReaders {
  return {
    findCard: async (name) => (name === "Nope" ? null : { oracleId: `o-${name}`, name }),
    similar: async () => list,
    budget: async () => ({ cards: [], minPriceCents: 500, maxPriceCents: 200 }),
    profile: async () => ({
      ...EMPTY_DECK_PROFILE,
      avoid: [{ cardName: "Mortuary", reason: "no" }],
    }),
    ...overrides,
  };
}

describe("similarTo", () => {
  it("leaves out the deck's avoid cards and names them once", async () => {
    const { similarTo } = makeFindReplacements(readers());
    const result = await similarTo({ userId, deckId: 1, card: "Sol Ring" });
    expect(result.ok && result.value.owned.map((each) => each.card.name)).toEqual(["Kept"]);
    expect(result.ok && result.value.store).toEqual([]);
    expect(result.ok && result.value.avoided).toEqual(["Mortuary"]);
    expect(result.ok && result.value.hiddenOverTarget).toBe(2);
  });

  it("says when the card or the deck isn't found", async () => {
    const { similarTo } = makeFindReplacements(readers({ similar: async () => null }));
    expect(await similarTo({ userId, deckId: 1, card: "Nope" })).toEqual({
      ok: false,
      error: { kind: "CardNotFound" },
    });
    expect(await similarTo({ userId, deckId: 1, card: "Sol Ring" })).toEqual({
      ok: false,
      error: { kind: "DeckNotFound" },
    });
  });
});

describe("cheaperAlternatives", () => {
  it("passes the card's oracle id and the price limits on", async () => {
    let seen: unknown;
    const { cheaperAlternatives } = makeFindReplacements(
      readers({
        budget: async (_user, _deck, options) => {
          seen = options;
          return { cards: [], minPriceCents: 1, maxPriceCents: 2 };
        },
      }),
    );
    await cheaperAlternatives({ userId, deckId: 1, card: "Sol Ring", maxPriceCents: 300 });
    expect(seen).toEqual({ oracleId: "o-Sol Ring", minPriceCents: undefined, maxPriceCents: 300 });
  });

  it("says when the card or the deck isn't found", async () => {
    const { cheaperAlternatives } = makeFindReplacements(readers({ budget: async () => null }));
    expect(await cheaperAlternatives({ userId, deckId: 1, card: "Nope" })).toMatchObject({
      error: { kind: "CardNotFound" },
    });
    expect(await cheaperAlternatives({ userId, deckId: 1 })).toMatchObject({
      error: { kind: "DeckNotFound" },
    });
  });
});
