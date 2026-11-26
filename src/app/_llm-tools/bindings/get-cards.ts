import { z } from "zod";
import { ok } from "@/shared/kernel";
import { defineBinding } from "../binding";
import { presentCompactCards, presentFullCards, presentOwnedCards } from "../present/get-cards";

type Answer =
  | Readonly<{ detail: "owned"; checked: Parameters<typeof presentOwnedCards>[0] }>
  | Readonly<{ detail: "compact" | "full"; cards: Parameters<typeof presentFullCards>[0] }>;

export const getCardsBinding = defineBinding({
  name: "get_cards",
  title: "Get card details or batch-check ownership",
  description:
    "Look up 1-100 cards. `detail='owned'` (fast batch check: owned counts, decks), `detail='compact'` (default, up to 25 cards: adds manaCost, typeLine, oracle rules text, wishes), or `detail='full'` (adds store printings & price trend). Prices are omitted unless `includePrice: true` or `detail='full'`.",
  scope: "read",
  readOnly: true,
  input: z.object({
    cards: z.array(z.string().min(1)).min(1).max(100).describe("Card names or ids."),
    detail: z
      .enum(["owned", "compact", "full"])
      .default("compact")
      .describe("Response detail level: 'owned', 'compact' (default), or 'full'."),
    includePrice: z
      .boolean()
      .default(false)
      .describe("Include store price in cents (default false; always included in detail='full')."),
    includeSets: z
      .boolean()
      .default(false)
      .describe(
        "Include a flat deduplicated list of enabled set codes per card (for detail='compact').",
      ),
    cursor: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Pagination cursor from a previous capped response's `next` field; re-send the same `cards` list with this cursor to get the remaining items.",
      ),
  }),
  async call(capabilities, actor, input) {
    if (input.detail === "owned") {
      const checked = await capabilities.checkOwnedCards(actor, {
        names: input.cards,
      });
      return ok<Answer>({ detail: "owned", checked: checked.value });
    }
    const cards = await capabilities.lookUpCards(actor, {
      queries: input.cards.slice(0, 25),
      includeSets: input.includeSets && input.detail === "compact",
    });
    if (!cards.ok) return cards;
    return ok<Answer>({ detail: input.detail, cards: cards.value });
  },
  present: (answer, { input }) =>
    answer.detail === "owned"
      ? presentOwnedCards(answer.checked, input.includePrice)
      : answer.detail === "full"
        ? presentFullCards(answer.cards)
        : presentCompactCards(answer.cards, {
            includePrice: input.includePrice,
            includeSets: input.includeSets,
          }),
  describeError: () => ({ kind: "Unexpected", message: "get_cards cannot fail." }),
});
