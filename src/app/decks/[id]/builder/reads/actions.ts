"use server";
import { z } from "zod";
import { type PrintingCard } from "@/modules/catalog";
import {
  BROWSE_SORTS,
  BROWSE_SOURCES,
  type BrowsePage,
  type BudgetList,
  type DeckDraft,
  type DeckSuggestions,
  type ManaBasePlan,
  type OptimizeDeckPool,
  type OptimizeResult,
  type OtherDeckUse,
  type PrintingOption,
  type SuggestionList,
  type TokenLine,
} from "@/modules/decks";
import { ColorSchema } from "@/shared/kernel";

import { builderAction, DeckIdInput } from "../action-helpers";

// The builder's reads: browsing, details, suggestions and the other panels (ADR 0026).

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
export const browseAction = builderAction<typeof BrowseInput, BrowsePage | null>(
  BrowseInput,
  null,
  async ({ actor, capabilities }, input) => capabilities.deckReads.browse(actor.userId, input),
);

/** A card's details for the selected-card panel and previews. */
export const cardDetailAction = builderAction<z.ZodString, PrintingCard | null>(
  z.string().regex(/^[0-9a-f-]{36}$/),
  null,
  async ({ capabilities }, printingId) =>
    (await capabilities.printingDetails([printingId])).get(printingId) ?? null,
);

const CardInDeckInput = z.object({ deckId: DeckIdInput, oracleId: z.string().min(1) });

/** Your other decks holding a card, for the selected-card panel (task 42). */
export const otherDecksAction = builderAction<typeof CardInDeckInput, OtherDeckUse[]>(
  CardInDeckInput,
  [],
  async ({ actor, capabilities }, input) =>
    capabilities.deckReads.otherDecksHolding(actor.userId, input.deckId, input.oracleId),
);

const PrintingsInput = z.object({ deckId: DeckIdInput, oracleId: z.string().uuid() });

/** Every printing of a card, for the printing picker (design doc 24). */
export const printingsAction = builderAction<typeof PrintingsInput, PrintingOption[] | null>(
  PrintingsInput,
  null,
  async ({ actor, capabilities }, input) =>
    capabilities.deckReads.printingsOf(actor.userId, input.deckId, input.oracleId),
);

const suggestionsFor = builderAction<typeof DeckIdInput, DeckSuggestions | null>(
  DeckIdInput,
  null,
  async ({ actor, capabilities }, deckId) =>
    capabilities.deckReads.suggestions(actor.userId, deckId),
);

/** Cards for this deck and for each role it's short of (design doc 20). */
export async function suggestionsAction(deckId: number): Promise<DeckSuggestions | null> {
  return suggestionsFor(deckId);
}

const OptimizeInput = z.object({
  deckId: DeckIdInput,
  pool: z.enum(["owned", "store", "both"]),
});
const optimizeDeck = builderAction<typeof OptimizeInput, OptimizeResult | null>(
  OptimizeInput,
  null,
  async ({ actor, capabilities }, input) =>
    capabilities.deckReads.optimize(actor.userId, input.deckId, input.pool),
);

/** Whole-deck Simulated Annealing optimizer preview (design doc 55). */
export async function optimizeDeckAction(
  deckId: number,
  pool: OptimizeDeckPool = "owned",
): Promise<OptimizeResult | null> {
  return optimizeDeck({ deckId, pool });
}

const manaBase = builderAction<typeof DeckIdInput, ManaBasePlan | null>(
  DeckIdInput,
  null,
  async ({ actor, capabilities }, deckId) => {
    const plan = await capabilities.deckManaPlan({ userId: actor.userId, deckId });
    return plan.ok ? plan.value : null;
  },
);

/** A mana base you could start from (design doc 35). */
export async function manaBaseAction(deckId: number): Promise<ManaBasePlan | null> {
  return manaBase(deckId);
}

const DraftDeckInput = z.object({
  deckId: DeckIdInput,
  includeStore: z.enum(["fill-gaps", "none"]).optional(),
});

/** A 100-card Commander draft from owned cards first (design doc 37). */
export const draftDeckAction = builderAction<typeof DraftDeckInput, DeckDraft | null>(
  DraftDeckInput,
  null,
  async ({ actor, capabilities }, input) =>
    capabilities.deckReads.draft(actor.userId, input.deckId, {
      includeStore: input.includeStore,
    }),
);

const SimilarInput = z.object({ deckId: DeckIdInput, oracleId: z.string().uuid() });

/** Cards like the selected one, for this deck. */
export const similarAction = builderAction<typeof SimilarInput, SuggestionList | null>(
  SimilarInput,
  null,
  async ({ actor, capabilities }, input) =>
    capabilities.deckReads.similar(actor.userId, input.deckId, input.oracleId),
);

/** The most a budget list may spend: $1,000. */
const BUDGET_MAXIMUM_CENTS = 100_000;
const BudgetInput = z.object({
  deckId: DeckIdInput,
  budgetCents: z.number().int().min(1).max(BUDGET_MAXIMUM_CENTS),
});

/** Store cards for this deck within a budget. */
export const budgetAction = builderAction<typeof BudgetInput, BudgetList | null>(
  BudgetInput,
  null,
  async ({ actor, capabilities }, input) =>
    capabilities.deckReads.budgetList(actor.userId, input.deckId, input.budgetCents),
);

/** Tokens, emblems, and helper cards created by a deck's counted cards (design doc 42). */
const tokens = builderAction<typeof DeckIdInput, TokenLine[] | null>(
  DeckIdInput,
  null,
  async ({ actor, capabilities }, deckId) => {
    const overview = await capabilities.deckOverview({
      userId: actor.userId,
      deckId,
      parts: { tokens: true },
    });
    return overview.ok ? [...(overview.value.tokens ?? [])] : null;
  },
);

/** Tokens, emblems, and helper cards created by a deck's counted cards (design doc 42). */
export async function tokensAction(deckId: number): Promise<TokenLine[] | null> {
  return tokens(deckId);
}
