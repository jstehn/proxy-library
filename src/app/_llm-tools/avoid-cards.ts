// Leaves a deck profile's "avoid" cards out of the tools that suggest cards to add (design doc 61,
// invariant 4), and says which ones it left out so the model knows why they're missing.

import { getDeckProfile, type DeckPlan } from "@/modules/decks";
import type { ToolContext } from "./tool";

/** The deck's stored profile, or null when it has none (or the deck isn't the player's). */
export async function deckProfileFor(
  context: ToolContext,
  deckId: number,
): Promise<DeckPlan | null> {
  const stored = await getDeckProfile(context.container.db, context.actor.userId, deckId);
  return stored?.profile ?? null;
}
