"use server";
import { z } from "zod";
import type { BudgetList, DeckSuggestions } from "@/modules/decks";
import { action } from "@/server/action-instance";
import { DeckIdInput } from "../action-helpers";

// The suggestions panel's reads (design doc 20), also used by the possible-cuts panel.

/** Cards for this deck and for each role it's short of (design doc 20). */
export const suggestionsAction = action(
  DeckIdInput,
  async ({ actor, capabilities }, deckId): Promise<DeckSuggestions | null> =>
    capabilities.deckReads.suggestions(actor.userId, deckId),
);

/** The most a budget list may spend: $1,000. */
const BUDGET_MAXIMUM_CENTS = 100_000;
const BudgetInput = z.object({
  deckId: DeckIdInput,
  budgetCents: z.number().int().min(1).max(BUDGET_MAXIMUM_CENTS),
});

/** Store cards for this deck within a budget. */
export const budgetAction = action(
  BudgetInput,
  async ({ actor, capabilities }, input): Promise<BudgetList | null> =>
    capabilities.deckReads.budgetList(actor.userId, input.deckId, input.budgetCents),
);
