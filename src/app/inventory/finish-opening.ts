import type { Actor } from "@/modules/accounts";
import { becomesADeck } from "@/modules/decks";
import type { Opening } from "@/modules/inventory";
import type { Capabilities } from "@/server/composition/capabilities";
import { INVENTORY_PATH, revalidateOpened } from "./paths";

/**
 * Turns any opened precons into decks, revalidates the opened view, and returns the URL to
 * animate the newly opened packs.
 */
export async function finishOpening(
  actor: Actor,
  capabilities: Capabilities,
  openings: readonly Opening[],
): Promise<string> {
  const newDecks: string[] = [];
  for (const opening of openings) {
    if (opening.kind !== "deck" || !becomesADeck(opening.deckType)) continue;
    const created = await capabilities.deckEdits.createDeckFromCards(actor, {
      name: opening.item.name,
      cards: opening.cards,
    });
    if (created.ok) newDecks.push(opening.item.name);
  }

  revalidateOpened();
  const ids = openings.map((opening) => opening.item.id).join(",");
  const decks = newDecks.length > 0 ? `&decks=${encodeURIComponent(newDecks.join(" | "))}` : "";
  return `${INVENTORY_PATH}/opened?items=${ids}&animate=1${decks}`;
}
