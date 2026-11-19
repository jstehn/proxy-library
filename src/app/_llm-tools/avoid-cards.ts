// Leaves a deck profile's "avoid" cards out of the tools that suggest cards to add (design doc 61,
// invariant 4), and says which ones it left out so the model knows why they're missing.

import { getDeckProfile, isAvoidCard, type DeckPlan } from "@/modules/decks";
import type { ToolContext } from "./tool";

export type AvoidSplit<Item> = Readonly<{
  kept: Item[];
  /** Names of the avoid cards that were left out, once each. */
  avoided: string[];
}>;

/** The items whose card isn't on the profile's avoid list, and the names of those that were. */
export function withoutAvoidCards<Item>(
  items: readonly Item[],
  nameOf: (item: Item) => string,
  profile: DeckPlan | null | undefined,
): AvoidSplit<Item> {
  const kept: Item[] = [];
  const avoided = new Set<string>();
  for (const item of items) {
    const name = nameOf(item);
    if (isAvoidCard(name, profile)) avoided.add(name);
    else kept.push(item);
  }
  return { kept, avoided: [...avoided] };
}

/** The deck's stored profile, or null when it has none (or the deck isn't the player's). */
export async function deckProfileFor(
  context: ToolContext,
  deckId: number,
): Promise<DeckPlan | null> {
  const stored = await getDeckProfile(context.container.db, context.actor.userId, deckId);
  return stored?.profile ?? null;
}
