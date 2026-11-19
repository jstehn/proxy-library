import { describeDeckError, type DeckError } from "@/modules/decks";
import type { ToolError } from "../tool";

/** A decks-module failure as the model reads it: the kind and one sentence to act on. */
export function deckToolError(error: DeckError, deckId?: number): ToolError {
  if (error.kind === "DeckNotFound" && deckId !== undefined) {
    return {
      kind: error.kind,
      message: `Deck ${deckId} isn't one of your decks. Call list_decks to see their ids.`,
    };
  }
  return { kind: error.kind, message: describeDeckError(error) };
}
