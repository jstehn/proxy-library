"use server";
import { z } from "zod";
import { formRedirect } from "@/server/form-action-instance";
import { DECKS_PATH, deckPath, revalidateDeckList } from "../paths";

// Find a commander (design doc 36, section 9): starting a deck led by a commander.

const COMMANDERS_PATH = `${DECKS_PATH}/commanders`;

/** A deck's name from a commander's: the front face, cut to the deck name limit. */
function deckName(commander: string): string {
  return commander.split(" // ")[0].slice(0, 60);
}

/** Start a Commander deck led by this card, and open it in the builder. */
export const startDeckAction = formRedirect(
  z.object({ name: z.string().default(""), real: z.string().optional() }),
  async ({ actor, capabilities }, { name, real }) => {
    const started = await capabilities.startDeck.startDeck(actor, {
      name: deckName(name),
      format: "commander",
      list: `Commander\n1 ${name}`,
      usesRealCards: real === "1",
    });
    if (!started.ok) {
      const message =
        started.error.kind === "NameInvalid"
          ? "That name doesn't fit a deck name."
          : `You already have ${started.error.maximum} decks.`;
      return `${COMMANDERS_PATH}?error=${encodeURIComponent(message)}`;
    }
    revalidateDeckList();
    return deckPath(started.value.deckId);
  },
);
