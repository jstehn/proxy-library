import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { makeListDecks, type DeckListing } from "./list-decks";

const deck: DeckListing = {
  id: 1,
  name: "Elves",
  format: "commander",
  cards: 99,
  short: 3,
  usesRealCards: false,
  visibility: "private",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("listDecks", () => {
  it("returns the decks the reader gives for this player", async () => {
    const asked: string[] = [];
    const listDecks = makeListDecks({
      decksFor: async (userId) => {
        asked.push(userId);
        return [deck];
      },
    });
    const result = await listDecks({ userId: UserId.of("7") });
    expect(result).toEqual({ ok: true, value: [deck] });
    expect(asked).toEqual(["7"]);
  });

  it("returns an empty list for a player with no decks", async () => {
    const listDecks = makeListDecks({ decksFor: async () => [] });
    expect(await listDecks({ userId: UserId.of("1") })).toEqual({ ok: true, value: [] });
  });
});
