"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DeckId, describeDeckError } from "@/modules/decks";
import { action } from "@/server/action-instance";
import { err, ok } from "@/shared/kernel";
import { DeckIdInput } from "../action-helpers";
import { rejected } from "../answer";

const TargetBracketInput = z.object({
  deckId: DeckIdInput,
  target: z.number().int().nullable(),
});

/** Saves the Commander bracket the owner is aiming for, or clears it (design doc 31). */
export const setTargetBracketAction = action(
  TargetBracketInput,
  async ({ actor, capabilities }, input) => {
    const result = await capabilities.deckEdits.updateDeck(actor, {
      deckId: DeckId.of(input.deckId),
      targetBracket: input.target,
    });
    if (!result.ok) return err(rejected(describeDeckError(result.error)));
    // The shared view shows the target too.
    revalidatePath(`/decks/${input.deckId}`);
    return ok(null);
  },
);
