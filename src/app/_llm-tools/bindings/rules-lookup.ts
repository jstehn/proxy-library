import { z } from "zod";
import type { CardInteractions, CardRulings, RulesCardNotFound } from "@/modules/catalog";
import { err, ok } from "@/shared/kernel";
import { defineBinding } from "../binding";

type Answer =
  | Readonly<{
      kind: "rules";
      crVersion: string | null;
      hits: readonly unknown[];
    }>
  | Readonly<{ kind: "interactions"; interactions: CardInteractions }>
  | Readonly<{ kind: "rulings"; rulings: CardRulings }>;

type Failure = Readonly<{ kind: "InvalidInput"; message: string }> | RulesCardNotFound;

export const rulesLookupBinding = defineBinding({
  name: "rules_lookup",
  title: "Card rulings, interactions, and Comprehensive Rules",
  description:
    "Look up official Scryfall rulings for 1 card, check rules interactions between 2+ `cards`, or search the MTG Comprehensive Rules by rule number/keyword (`query`).",
  scope: "read",
  readOnly: true,
  input: z.object({
    cards: z
      .array(z.string().min(1))
      .min(1)
      .max(4)
      .optional()
      .describe("1 card for rulings, or 2-4 cards to check interactions."),
    query: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Comprehensive Rules number (e.g. '702.61a') or keyword."),
  }),
  async call(capabilities, _actor, input) {
    const { rulesLookup } = capabilities;
    if (input.query) {
      const found = await rulesLookup.searchRules({ query: input.query, limit: 8 });
      return ok<Answer>({
        kind: "rules",
        crVersion: found.value.crVersion,
        hits: found.value.hits,
      });
    }
    if (input.cards && input.cards.length >= 2) {
      return ok<Answer>({
        kind: "interactions",
        interactions: await rulesLookup.interactionsOf(input.cards),
      });
    }
    if (input.cards && input.cards.length === 1) {
      const rulings = await rulesLookup.rulingsForCard(input.cards[0]);
      return rulings.ok ? ok<Answer>({ kind: "rulings", rulings: rulings.value }) : rulings;
    }
    return err<Failure>({
      kind: "InvalidInput",
      message: "Provide `cards` (1-4 names) or `query` (CR rule/keyword).",
    });
  },
  present(answer) {
    if (answer.kind === "rules") {
      return {
        crVersion: answer.crVersion,
        note:
          answer.crVersion === null
            ? "Comprehensive Rules have not been synced yet (run `pnpm worker sync-rules`). An empty result does not mean no rule exists."
            : "Top-ranked verbatim CR excerpts (not exhaustive). Follow any cross-referenced rule numbers and check get_rulings for card-specific rulings.",
        hits: answer.hits,
      };
    }
    if (answer.kind === "interactions") {
      const { cards, sharedRules, ruleInteractions } = answer.interactions;
      return { cards, sharedRules, ruleInteractions };
    }
    return { cards: [answer.rulings] };
  },
  describeError(failure) {
    if (failure.kind === "InvalidInput") return failure;
    return { kind: "CardNotFound", message: `No card named "${failure.query}" in catalog.` };
  },
});
