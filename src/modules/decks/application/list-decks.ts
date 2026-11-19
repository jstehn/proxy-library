import { ok, type Result, type UserId } from "@/shared/kernel";
import type { Format } from "../domain/deck";
import type { Visibility } from "../domain/sharing";

/** One line of "my decks": what the deck list and the LLM tool both show. */
export type DeckListing = Readonly<{
  id: number;
  name: string;
  format: Format;
  cards: number;
  /** Copies the deck uses beyond what the player owns. */
  short: number;
  usesRealCards: boolean;
  visibility: Visibility;
  updatedAt: string;
}>;

export type ListDecksDependencies = Readonly<{
  /** The player's decks, most recently changed first (the adapter runs the query). */
  decksFor(userId: UserId): Promise<readonly DeckListing[]>;
}>;

/** Capability: a player's decks, most recently changed first. */
export function makeListDecks(dependencies: ListDecksDependencies) {
  const { decksFor } = dependencies;

  async function listDecks(
    actor: Readonly<{ userId: UserId }>,
  ): Promise<Result<DeckListing[], never>> {
    const decks = await decksFor(actor.userId);
    return ok(decks.map((deck) => ({ ...deck })));
  }

  return listDecks;
}
