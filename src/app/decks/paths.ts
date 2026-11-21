import { revalidatePath } from "next/cache";

// The deck area's paths, and what to refresh after a change. Actions and pages use these; they
// don't write `/decks/...` strings or call `revalidatePath` themselves.

export const DECKS_PATH = "/decks";

/** A deck's page, with an error to show on it (the actions send errors back as `?error=`). */
export function deckPath(deckId: number, error?: string): string {
  return error === undefined
    ? `/decks/${deckId}`
    : `/decks/${deckId}?error=${encodeURIComponent(error)}`;
}

/** The deck list: after a deck is made, deleted, shared or its card set changes. */
export function revalidateDeckList(): void {
  revalidatePath(DECKS_PATH);
}

/** One deck's page. */
export function revalidateDeck(deckId: number): void {
  revalidatePath(deckPath(deckId));
}
