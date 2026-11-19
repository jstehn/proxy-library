"use server";
import { z } from "zod";
import { BROWSE_SORTS, BROWSE_SOURCES, type BrowsePage } from "@/modules/decks";
import { action } from "@/server/action-instance";
import { ColorSchema } from "@/shared/kernel";

// The collection grid's server side: one page of cards for this deck (ADR 0026).

const BrowseInput = z.object({
  deckId: z.number().int().positive(),
  source: z.enum(BROWSE_SOURCES),
  search: z.string().max(400),
  colors: z.array(ColorSchema).max(5).nullable(),
  includeColorless: z.boolean(),
  onlyLegal: z.boolean(),
  sort: z.enum(BROWSE_SORTS),
  page: z.number().int().min(1).max(1000),
});

/** One page of your collection (or of every card for sale), filtered and sorted for this deck. */
export const browseAction = action(
  BrowseInput,
  async ({ actor, capabilities }, input): Promise<BrowsePage | null> =>
    capabilities.deckReads.browse(actor.userId, input),
);
