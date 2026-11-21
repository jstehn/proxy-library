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
export const buildFromCollectionAction = action(
  DraftDeckInput,
  async ({ actor, reads }, input): Promise<DeckDraft | null> =>
    reads.decks.draft(actor, input.deckId, {
      includeStore: input.includeStore,
    }),
);
