"use server";
import { z } from "zod";
import type { DeckDraft } from "@/modules/decks";
import { action } from "@/server/action-instance";
import { DeckIdInput } from "../action-helpers";

const DraftDeckInput = z.object({
  deckId: DeckIdInput,
  includeStore: z.enum(["fill-gaps", "none"]).optional(),
});

/** A 100-card Commander draft from owned cards first (design doc 37). */
export const draftDeckAction = action(
  DraftDeckInput,
  async ({ actor, capabilities }, input): Promise<DeckDraft | null> =>
    capabilities.deckReads.draft(actor.userId, input.deckId, {
      includeStore: input.includeStore,
    }),
);
