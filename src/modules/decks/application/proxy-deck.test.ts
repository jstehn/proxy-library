import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import type { DeckView } from "../domain/deck-view";
import { makeProxyDeck } from "./proxy-deck";

const view = {
  deck: { id: 5, name: "Deck" },
  lines: [
    {
      oracleId: "o1",
      printingId: "p1",
      name: "Missing Card",
      quantity: 2,
      ownedReal: 0,
      board: "main",
      isBasicLand: false,
      finish: "foil",
    },
  ],
} as unknown as DeckView;

describe("proxyDeck", () => {
  it("builds a name-only proxy for a printing missing from the catalog, and marks foils", async () => {
    const proxyDeck = makeProxyDeck({
      deckView: async () => view,
      printingCards: async () => new Map(),
      tokenLines: async () => [],
    });
    const deck = await proxyDeck(UserId.of("1"), 5);
    const [line] = deck?.lines ?? [];
    expect(line?.isFoil).toBe(true);
    expect(line?.hasBack).toBe(false);
    expect(line?.printed.faces[0]?.name).toBe("Missing Card");
  });

  it("is null when the deck isn't the player's or the id isn't a whole number", async () => {
    const proxyDeck = makeProxyDeck({
      deckView: async () => null,
      printingCards: async () => new Map(),
      tokenLines: async () => [],
    });
    expect(await proxyDeck(UserId.of("1"), 5)).toBeNull();
    expect(await proxyDeck(UserId.of("1"), 1.5)).toBeNull();
  });
});
