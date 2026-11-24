import { z } from "zod";
import { ok } from "@/shared/kernel";
import { defineBinding } from "../binding";
import { overviewPartsFor, presentGetDeck } from "../present/get-deck";
import { deckToolError } from "./deck-error";

export const getDeckBinding = defineBinding({
  name: "get_deck",
  title: "Get deck",
  description:
    "Returns a compact deck view (header, profile summary, card lines, bracket, problems). Oracle text is off by default to save tokens, but you should set `includeText: true` (or `include: ['text']`) the first time you pull a deck. Pass `include` for 'facts', 'signals', 'mana_plan', 'primer', 'prices', etc. 'facts', 'signals' and 'mana_plan' are heuristic checks to verify, not verdicts.",
  scope: "read",
  readOnly: true,
  pagesItself: true,
  input: z.object({
    deckId: z.number().int().positive().describe("Deck id from list_decks."),
    includeText: z
      .boolean()
      .default(false)
      .describe(
        "Include oracle rules text (off by default; set true the first time you pull a deck).",
      ),
    include: z
      .array(
        z.enum([
          "facts",
          "signals",
          "mana_plan",
          "primer",
          "text",
          "short",
          "owners",
          "prices",
          "ids",
          "tokens",
          "odds",
          "sources",
          "formatRules",
          "legality",
        ]),
      )
      .optional()
      .describe(
        "Optional extra sections: 'facts', 'signals', 'mana_plan', 'primer', 'text', 'short', 'owners', 'prices', 'ids', 'tokens', 'odds', 'sources', 'formatRules', 'legality'.",
      ),
    view: z
      .enum(["compact", "full"])
      .default("compact")
      .describe("Response shape: 'compact' (default) or 'full'."),
    cards: z
      .array(z.string().min(1))
      .max(20)
      .optional()
      .describe("Inspect full detail for specific card names in this deck."),
    boards: z
      .array(z.enum(["main", "side", "commander", "maybe"]))
      .optional()
      .describe("Optional board filter (e.g. ['main', 'maybe'])."),
    cursor: z.number().int().min(0).optional().describe("Pagination cursor from previous `next`."),
  }),
  async call(capabilities, actor, input) {
    const { deckId } = input;
    const asked = { ...input, include: input.include ?? [] };
    const overview = await capabilities.deckOverview(actor, {
      deckId,
      parts: overviewPartsFor(asked),
    });
    if (!overview.ok) return overview;
    const wants = (name: (typeof asked.include)[number]) => asked.include.includes(name);
    const [facts, signals, manaPlan] = await Promise.all([
      wants("facts")
        ? capabilities.deckFacts({ view: overview.value.view, includeMaybe: false })
        : undefined,
      wants("signals")
        ? capabilities.deckSignals({ userId: actor.userId, deckId, minimumCards: 1 })
        : undefined,
      wants("mana_plan") ? capabilities.deckManaPlan({ userId: actor.userId, deckId }) : undefined,
    ]);
    return ok({
      overview: overview.value,
      ...(facts?.ok ? { facts: facts.value } : {}),
      ...(signals?.ok ? { signals: signals.value } : {}),
      ...(manaPlan?.ok ? { manaPlan: manaPlan.value } : {}),
    });
  },
  present: (answer, { input }) =>
    presentGetDeck(answer, { ...input, include: input.include ?? [] }),
  describeError: (error, { input }) => deckToolError(error, input.deckId),
});
