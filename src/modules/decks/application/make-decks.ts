import { makeManageDecks } from "./manage-decks";
import type { DecksDependencies } from "./ports";

/** Builds every deck use case from one set of dependencies. */
export function makeDecks(dependencies: DecksDependencies) {
  return makeManageDecks(dependencies);
}

export type Decks = ReturnType<typeof makeDecks>;
