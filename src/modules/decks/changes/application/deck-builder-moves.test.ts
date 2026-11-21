import { describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { err, ok, UserId } from "@/shared/kernel";
import type { DeckView } from "@/modules/decks/core/client";
import { makeSwapCards, makeTakeFromDeck } from "./deck-builder-moves";

const actor = { userId: UserId.of("1") } as Actor;

function viewOf(name: string, lines: ReadonlyArray<[string, string, number]>): DeckView {
  return {
    deck: { name },
    lines: lines.map(([oracleId, board, quantity]) => ({ oracleId, board, quantity })),
  } as unknown as DeckView;
}

describe("swapCards", () => {
  function setup(view: DeckView | null) {
    const applied: unknown[] = [];
    const swapCards = makeSwapCards({
      deckView: async () => view,
      applyChanges: async (_actor, input) => {
        applied.push(input);
        return ok({});
      },
    });
    return { swapCards, applied };
  }
  const input = { deckId: 5, cutOracleId: "cut", addOracleId: "add" };

  it("moves one copy of the cut to the maybeboard and adds one of the replacement", async () => {
    const { swapCards, applied } = setup(
      viewOf("Deck", [
        ["cut", "main", 2],
        ["cut", "maybe", 1],
        ["add", "main", 1],
      ]),
    );
    expect((await swapCards(actor, input)).ok).toBe(true);
    expect((applied[0] as { changes: unknown }).changes).toEqual([
      { oracleId: "cut", board: "main", quantity: 1 },
      { oracleId: "cut", board: "maybe", quantity: 2 },
      { oracleId: "add", board: "main", quantity: 2 },
    ]);
  });

  it("says when the deck isn't the player's or the card has left the main deck", async () => {
    expect(await setup(null).swapCards(actor, input)).toEqual(err({ kind: "DeckNotFound" }));
    const gone = setup(viewOf("Deck", [["cut", "maybe", 1]]));
    expect(await gone.swapCards(actor, input)).toEqual(err({ kind: "CardNotInMainDeck" }));
    expect(gone.applied).toEqual([]);
  });
});

describe("takeFromDeck", () => {
  function setup(from: DeckView | null) {
    const edits: unknown[] = [];
    const takeFromDeck = makeTakeFromDeck({
      deckView: async () => from,
      setEntry: async (_actor, edit) => {
        edits.push(edit);
        return ok({});
      },
    });
    return { takeFromDeck, edits };
  }

  it("takes the sideboard copies first, then main-deck copies", async () => {
    const { takeFromDeck, edits } = setup(
      viewOf("Other", [
        ["card", "side", 1],
        ["card", "main", 2],
      ]),
    );
    const result = await takeFromDeck(actor, {
      deckId: 5,
      fromDeckId: 6,
      oracleId: "card",
      count: 2,
    });
    expect(result.ok).toBe(true);
    expect(edits).toEqual([
      { deckId: 6, oracleId: "card", board: "side", quantity: 0 },
      { deckId: 6, oracleId: "card", board: "main", quantity: 1 },
    ]);
  });

  it("refuses a deck that isn't yours or is this deck itself", async () => {
    const own = { deckId: 5, fromDeckId: 5, oracleId: "card", count: 1 };
    expect(await setup(viewOf("Same", [])).takeFromDeck(actor, own)).toEqual(
      err({ kind: "DeckNotFound" }),
    );
    expect(await setup(null).takeFromDeck(actor, { ...own, fromDeckId: 6 })).toEqual(
      err({ kind: "DeckNotFound" }),
    );
  });
});
