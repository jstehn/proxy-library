import { makeDeckEntries } from "./deck-entries";
import { makeDeckHeadings } from "./deck-headings";
import { makeDeckLifecycle } from "./deck-lifecycle";
import { makeDeckLists } from "./deck-lists";
import { makeDeckPrintings } from "./deck-printings";
import { makeDeckSnapshots } from "./deck-snapshots";
import type { DecksDependencies } from "./ports";

/** Builds every deck use case from one set of dependencies, one factory per job. */
export function makeDecks(dependencies: DecksDependencies) {
  return {
    ...makeDeckLifecycle(dependencies),
    ...makeDeckEntries(dependencies),
    ...makeDeckLists(dependencies),
    ...makeDeckHeadings(dependencies),
    ...makeDeckPrintings(dependencies),
    ...makeDeckSnapshots(dependencies),
  };
}

export type Decks = ReturnType<typeof makeDecks>;
