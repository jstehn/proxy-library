/** A deck's page, with an error to show on it (the actions send errors back as `?error=`). */
export function deckPath(deckId: number, error?: string): string {
  return error === undefined
    ? `/decks/${deckId}`
    : `/decks/${deckId}?error=${encodeURIComponent(error)}`;
}
