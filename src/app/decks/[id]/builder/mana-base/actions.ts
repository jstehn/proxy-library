"use server";
import { z } from "zod";
import { DeckId, type ManaBasePlan } from "@/modules/decks";
import { action } from "@/server/action-instance";
import { afterChange, DeckIdInput } from "../action-helpers";

// The mana base panel's server side (design doc 35): the plan, and adding its lands. The draft
// panel adds lands the same way.

/** A mana base you could start from (design doc 35). */
export const manaBaseAction = action(
  DeckIdInput,
  async ({ actor, capabilities }, deckId): Promise<ManaBasePlan | null> => {
    const plan = await capabilities.deckManaPlan({ userId: actor.userId, deckId });
    return plan.ok ? plan.value : null;
  },
);

const AddLandsInput = z.object({
  deckId: DeckIdInput,
  lands: z
    .array(z.object({ oracleId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(100),
});

/** Adds the planned lands to the main deck in one go, and returns the fresh deck. */
export const addLandsAction = action(AddLandsInput, async (context, input) =>
  afterChange(
    context,
    input.deckId,
    await context.capabilities.deckEdits.addCards(context.actor, {
      deckId: DeckId.of(input.deckId),
      cards: input.lands,
    }),
  ),
);
