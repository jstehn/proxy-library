"use server";
import { z } from "zod";
import { becomesADeck } from "@/modules/decks";
import { ItemId } from "@/modules/inventory";
import { formRedirect } from "@/server/form-action-instance";
import { INVENTORY_PATH, inventoryErrorPath, revalidateOpened } from "./paths";

const OpenForm = z.object({
  itemIds: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .transform((text) => text.split(",").map((id) => ItemId.of(Number(id)))),
  mode: z.enum(["one", "all"]),
});

/** Opens one item, or opens items and everything inside them, then shows what came out. */
export const openAction = formRedirect(
  OpenForm,
  async ({ actor, capabilities }, { itemIds, mode }) => {
    const { inventory } = capabilities;
    const [first] = itemIds;
    const result =
      mode === "one"
        ? await inventory.openItem(actor, first)
        : await inventory.openAll(actor, itemIds);
    if (!result.ok) return inventoryErrorPath(result.error.kind);

    const openings = Array.isArray(result.value) ? result.value : [result.value];

    // Opened precons go straight into the deck list (feedback 2026-09-27). The cards are already
    // in the collection, so the new deck starts with everything owned.
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
    // animate=1: play the packs in the opener first (design doc 08, section 5).
    const ids = openings.map((opening) => opening.item.id).join(",");
    const decks = newDecks.length > 0 ? `&decks=${encodeURIComponent(newDecks.join(" | "))}` : "";
    return `${INVENTORY_PATH}/opened?items=${ids}&animate=1${decks}`;
  },
  { unreadable: inventoryErrorPath("ItemNotFound") },
);
