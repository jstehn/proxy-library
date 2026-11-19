import { z } from "zod";
import type { BudgetReplacementsResult, SimilarCards } from "@/modules/decks";
import { err, ok } from "@/shared/kernel";
import { defineBinding } from "../binding";
import { presentBudgetReplacements, presentSimilarCards } from "../present/replacements";

type Answer =
  | Readonly<{ kind: "similar"; similar: SimilarCards }>
  | Readonly<{ kind: "budget"; budget: BudgetReplacementsResult }>;

type Failure =
  | Readonly<{ kind: "InvalidInput"; message: string }>
  | Readonly<{ kind: "CardNotFound" | "DeckNotFound" }>;

export const findReplacementsBinding = defineBinding({
  name: "find_replacements",
  title: "Find similar or budget replacement cards",
  description:
    "Find similar cards for a given `card` (optionally scoped to `deckId` and `maxPriceCents`), or find budget replacements for expensive cards in `deckId`.",
  scope: "read",
  readOnly: true,
  input: z.object({
    card: z.string().min(1).optional().describe("Card name to find alternatives for."),
    deckId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional deck id for color/format/bracket filtering."),
    where: z.enum(["owned", "store", "both"]).default("both").describe("Candidate pool."),
    maxPriceCents: z.number().int().min(0).optional().describe("Max price in cents."),
    limit: z.number().int().min(1).max(20).default(10).describe("Max candidates (default 10)."),
    includeText: z.boolean().default(false).describe("Include oracle rules text (default false)."),
  }),
  async call(capabilities, actor, input) {
    const { userId } = actor;
    if (input.card !== undefined) {
      if (input.deckId === undefined) {
        return err<Failure>({
          kind: "InvalidInput",
          message: "Similar cards are found for a deck: give `deckId` with `card`.",
        });
      }
      const similar = await capabilities.replacements.similarTo({
        userId,
        deckId: input.deckId,
        card: input.card,
      });
      return similar.ok ? ok<Answer>({ kind: "similar", similar: similar.value }) : similar;
    }
    if (input.deckId !== undefined) {
      const budget = await capabilities.replacements.cheaperAlternatives({
        userId,
        deckId: input.deckId,
        maxPriceCents: input.maxPriceCents,
      });
      return budget.ok ? ok<Answer>({ kind: "budget", budget: budget.value }) : budget;
    }
    return err<Failure>({ kind: "InvalidInput", message: "Provide `card` or `deckId`." });
  },
  present: (answer, { input }) =>
    answer.kind === "similar"
      ? presentSimilarCards(answer.similar, input.includeText)
      : presentBudgetReplacements(answer.budget, input.includeText),
  describeError: (failure, { input }) => {
    if (failure.kind === "InvalidInput") return failure;
    if (failure.kind === "DeckNotFound") {
      return {
        kind: "DeckNotFound",
        message: `Deck ${input.deckId} isn't one of your decks. Call list_decks to see their ids.`,
      };
    }
    return {
      kind: "CardNotFound",
      message: `No card named "${input.card}" in this catalog. Check the spelling, or find it with search_cards.`,
    };
  },
});
