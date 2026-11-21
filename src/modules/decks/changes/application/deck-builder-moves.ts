import type { Actor } from "@/modules/accounts";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { Board } from "@/modules/decks/core/client";
import type { DeckView } from "@/modules/decks/core/client";
import type { DeckChanged, DeckNotFound } from "@/modules/decks/core/client";
import { takeCopies } from "../domain/free-copies";
import { fingerprint } from "@/modules/decks/core/client";
import type {
  ApplyChangesError,
  ApplyChangesInput,
  SetEntryError,
  SetEntryInput,
} from "@/modules/decks/core";

// The two builder moves that touch more than one card or deck: swapping a cut for an add, and
// taking copies out of another deck. Each is a capability over the decks' own use cases.

export type CardNotInMainDeck = Readonly<{ kind: "CardNotInMainDeck" }>;
export type CouldNotChangeDeck = Readonly<{ kind: "CouldNotChangeDeck"; deckName: string }>;

export type SwapCardsError = DeckNotFound | CardNotInMainDeck | DeckChanged | ApplyChangesError;
export type TakeFromDeckError = DeckNotFound | CouldNotChangeDeck;

type MoveReaders = Readonly<{
  deckView: (userId: UserId, deckId: number) => Promise<DeckView | null>;
}>;

type SwapDependencies = MoveReaders &
  Readonly<{
    applyChanges: (
      actor: Actor,
      input: Omit<ApplyChangesInput, "deckId"> & { deckId: number },
    ) => Promise<Result<unknown, ApplyChangesError>>;
  }>;

export type SwapCardsInput = Readonly<{ deckId: number; cutOracleId: string; addOracleId: string }>;

const MAXIMUM_COPIES = 99;

/** Moves one copy of a cut card to the maybeboard and adds one copy of its replacement to main. */
export function makeSwapCards(dependencies: SwapDependencies) {
  const { deckView, applyChanges } = dependencies;

  async function swapCards(
    actor: Actor,
    input: SwapCardsInput,
  ): Promise<Result<true, SwapCardsError>> {
    const { deckId, cutOracleId, addOracleId } = input;
    const view = await deckView(actor.userId, deckId);
    if (view === null) return err({ kind: "DeckNotFound" });

    const countOn = (oracleId: string, board: Board) =>
      view.lines.find((line) => line.oracleId === oracleId && line.board === board)?.quantity ?? 0;
    const cutMain = countOn(cutOracleId, "main");
    if (cutMain <= 0) return err({ kind: "CardNotInMainDeck" });

    const result = await applyChanges(actor, {
      deckId,
      fingerprint: fingerprint(view.lines),
      changes: [
        { oracleId: cutOracleId, board: "main", quantity: cutMain - 1 },
        {
          oracleId: cutOracleId,
          board: "maybe",
          quantity: Math.min(MAXIMUM_COPIES, countOn(cutOracleId, "maybe") + 1),
        },
        {
          oracleId: addOracleId,
          board: "main",
          quantity: Math.min(MAXIMUM_COPIES, countOn(addOracleId, "main") + 1),
        },
      ],
    });
    return result.ok ? ok(true) : err(result.error);
  }
  return swapCards;
}

type TakeDependencies = MoveReaders &
  Readonly<{
    setEntry: (
      actor: Actor,
      input: Omit<SetEntryInput, "deckId"> & { deckId: number },
    ) => Promise<Result<unknown, SetEntryError>>;
  }>;

export type TakeFromDeckInput = Readonly<{
  deckId: number;
  fromDeckId: number;
  oracleId: string;
  count: number;
}>;

/**
 * Takes copies of a card out of another of your decks, so they're free for this one (task 42):
 * the sideboard first, then the main deck, never a commander. This deck doesn't change.
 */
export function makeTakeFromDeck(dependencies: TakeDependencies) {
  const { deckView, setEntry } = dependencies;

  async function takeFromDeck(
    actor: Actor,
    input: TakeFromDeckInput,
  ): Promise<Result<true, TakeFromDeckError>> {
    const { deckId, fromDeckId, oracleId, count } = input;
    const from = await deckView(actor.userId, fromDeckId);
    if (from === null || fromDeckId === deckId) return err({ kind: "DeckNotFound" });

    const counts = from.lines.filter((line) => line.oracleId === oracleId);
    // One edit per board (the sideboard, then the main deck), each through the decks module.
    for (const change of takeCopies(counts, count)) {
      const result = await setEntry(actor, {
        deckId: fromDeckId,
        oracleId,
        board: change.board,
        quantity: change.quantity,
      });
      if (!result.ok) return err({ kind: "CouldNotChangeDeck", deckName: from.deck.name });
    }
    return ok(true);
  }
  return takeFromDeck;
}
