import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { DeckNotFound } from "../domain/errors";
import { countSignals, type SignalCard } from "../domain/signals";

// What a deck keeps doing (recurring mechanics, tokens, creature types, themes), with a follow-up
// search for each, from the deck's commander and main-deck cards.

export type DeckSignalReaders = Readonly<{
  /** The deck's cards, one each, or null when the deck isn't the player's. */
  signalCards(userId: UserId, deckId: number): Promise<SignalCard[] | null>;
}>;

export type DeckSignals = Readonly<{
  cardCount: number;
  signals: ReturnType<typeof countSignals>;
}>;

export type SearchSignalReaders = Readonly<{
  /** Your cards matching a search, one per card, with the notes about the search. */
  ownedCards(
    userId: UserId,
    search: string,
  ): Promise<Readonly<{ cards: SignalCard[]; notes: readonly string[] }>>;
}>;

export type SearchSignals = DeckSignals & Readonly<{ notes: readonly string[] }>;

/** The recurring mechanics in your cards that match a search (no deck needed). */
export function makeSearchSignals(readers: SearchSignalReaders) {
  async function searchSignals(
    request: Readonly<{ userId: UserId; search: string; minimumCards: number }>,
  ): Promise<Result<SearchSignals, never>> {
    const { cards, notes } = await readers.ownedCards(request.userId, request.search);
    return ok({
      cardCount: cards.length,
      notes,
      signals: countSignals(cards, { minimumCards: request.minimumCards }),
    });
  }
  return searchSignals;
}

export function makeDeckSignals(readers: DeckSignalReaders) {
  async function deckSignals(
    request: Readonly<{ userId: UserId; deckId: number; minimumCards: number }>,
  ): Promise<Result<DeckSignals, DeckNotFound>> {
    const cards = await readers.signalCards(request.userId, request.deckId);
    if (cards === null) return err({ kind: "DeckNotFound" });
    return ok({
      cardCount: cards.length,
      signals: countSignals(cards, { minimumCards: request.minimumCards }),
    });
  }
  return deckSignals;
}
