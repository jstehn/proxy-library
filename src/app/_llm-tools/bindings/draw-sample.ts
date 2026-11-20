import { z } from "zod";
import { defineBinding } from "../binding";
import { castTable } from "../present/cast-table";

export const drawSampleBinding = defineBinding({
  name: "draw_sample",
  title: "Sample opening hands and the chance to cast a card by each turn",
  description:
    'Deals `hands` shuffled 7-card opening hands plus the next `drawNext` cards, and simulates `trials` seeded games for the keepable-hand rate and turn-3 land drop. With `cast` (card names, or "commander") it also gives the measured chance of casting each card by turn 1, 2, ... `lastTurn`, with the median turn, the margin of error and the usual reasons a game missed. Rituals and cost reducers count. A measurement, not a score.',
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId: z.number().int().positive().describe("Deck id from list_decks."),
    hands: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(1)
      .describe("Opening hands to deal (1-5, default 1)."),
    drawNext: z
      .number()
      .int()
      .min(0)
      .max(15)
      .default(5)
      .describe("Next X cards drawn after the opening 7 (0-15, default 5)."),
    trials: z
      .number()
      .int()
      .min(100)
      .max(5000)
      .default(2000)
      .describe(
        "Simulated games for the odds and the cast curve (default 2000, about +/-2 points).",
      ),
    cast: z
      .array(z.string().min(1))
      .min(1)
      .max(5)
      .optional()
      .describe(
        'Card names to give the cast-by-turn curve for; "commander" is the deck commander.',
      ),
    onTheDraw: z
      .boolean()
      .default(false)
      .describe("Cast curve: on the draw (default: on the play)."),
    lastTurn: z.number().int().min(1).max(10).default(10).describe("Cast curve: last turn (1-10)."),
    seed: z.string().max(64).optional().describe("Optional deterministic RNG seed."),
  }),
  call: (capabilities, actor, input) =>
    capabilities.drawSample.drawSample({ userId: actor.userId, ...input }),
  present: (sample) => ({
    ...sample,
    ...(sample.cast ? { cast: castTable(sample.cast) } : {}),
  }),
  describeError(failure, { input }) {
    if (failure.kind === "DeckNotFound") {
      return {
        kind: "DeckNotFound",
        message: `Deck ${input.deckId} isn't one of your decks. Call list_decks to see their ids.`,
      };
    }
    if (failure.kind === "CastCardNotInDeck") {
      return {
        kind: "CastCardNotInDeck",
        message: `"${failure.name}" isn't a card in deck ${input.deckId}.`,
      };
    }
    return {
      kind: "DeckTooSmall",
      message: `Deck needs at least ${failure.minimum} main-board cards to draw a sample.`,
    };
  },
});
