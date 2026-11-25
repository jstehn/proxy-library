import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { EMPTY_DECK_PROFILE } from "@/modules/decks/core/client";
import { makeDeckSearch } from "./deck-search";

const userId = UserId.of("1");
const profile = { ...EMPTY_DECK_PROFILE, avoid: [{ cardName: "Mortuary", reason: "no" }] };
const request = {
  userId,
  deckId: 1,
  queries: [],
  where: "both" as const,
  perQuery: 5,
  maxPriceCents: null,
};

describe("deckSearch", () => {
  it("leaves the avoid cards out of a synergy search and names them", async () => {
    const { searchForDeck } = makeDeckSearch({
      searchForDeck: async () => ({ cards: [{ name: "Mortuary" }, { name: "Kept" }] }),
      semantic: async () => null,
      semanticCatalog: async () => ({ owned: [], store: [] }),
      profile: async () => profile,
    });
    const result = await searchForDeck(request);
    expect(result.ok && result.value.cards).toEqual([{ name: "Kept" }]);
    expect(result.ok && result.value.avoided).toEqual(["Mortuary"]);
  });

  it("leaves them out of both pools of a semantic search", async () => {
    const pick = (name: string) => ({ card: { name } });
    const { semantic } = makeDeckSearch({
      searchForDeck: async () => null,
      semantic: async () => ({ owned: [pick("Mortuary"), pick("A")], store: [pick("Mortuary")] }),
      semanticCatalog: async () => ({ owned: [], store: [] }),
      profile: async () => profile,
    });
    const result = await semantic({ userId, deckId: 1, concept: "x" });
    expect(result.ok && result.value.owned).toEqual([pick("A")]);
    expect(result.ok && result.value.store).toEqual([]);
    expect(result.ok && result.value.avoided).toEqual(["Mortuary"]);
  });

  it("supports deck-free semantic search across collection and store", async () => {
    const pick = (name: string) => ({ card: { name } });
    const { semantic } = makeDeckSearch({
      searchForDeck: async () => null,
      semantic: async () => null,
      semanticCatalog: async () => ({ owned: [pick("Ephemerate")], store: [pick("Cloudshift")] }),
      profile: async () => null,
    });
    const result = await semantic({ userId, concept: "blink creatures", where: "both" });
    expect(result.ok && result.value.owned).toEqual([pick("Ephemerate")]);
    expect(result.ok && result.value.store).toEqual([pick("Cloudshift")]);
    expect(result.ok && result.value.avoided).toEqual([]);
  });

  it("says when the deck isn't the player's", async () => {
    const { searchForDeck, semantic } = makeDeckSearch({
      searchForDeck: async () => null,
      semantic: async () => null,
      semanticCatalog: async () => ({ owned: [], store: [] }),
      profile: async () => null,
    });
    expect(await searchForDeck(request)).toEqual({ ok: false, error: { kind: "DeckNotFound" } });
    expect(await semantic({ userId, deckId: 1, concept: "x" })).toEqual({
      ok: false,
      error: { kind: "DeckNotFound" },
    });
  });
});
