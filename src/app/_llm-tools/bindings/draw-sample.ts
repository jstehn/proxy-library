import { z } from "zod";
import { defineBinding } from "../binding";

export const drawSampleBinding = defineBinding({
  name: "draw_sample",
  title: "Sample opening hands, next draws & deterministic castability",
  description:
    "Deals `hands` shuffled 7-card opening hands plus the next `drawNext` cards from the deck so you can evaluate playability, and runs deterministic simulation for keepable-hand rate, turn-3 land drop rate, and optional `mustCastBy` turn-N castability.",
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
      .max(2000)
      .default(500)
      .describe("Deterministic sim trials for odds (default 500)."),
    mustCastCard: z
      .string()
      .min(1)
      .optional()
      .describe("Card name for castable-by-turn-N sim (defaults to commander)."),
    mustCastTurn: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Turn by which mustCastCard should be castable."),
    seed: z.string().max(64).optional().describe("Optional deterministic RNG seed."),
  }),
  call: (capabilities, actor, input) =>
    capabilities.drawSample.drawSample({ userId: actor.userId, ...input }),
  present: (sample) => sample,
  describeError(failure, { input }) {
    if (failure.kind === "DeckNotFound") {
      return {
        kind: "DeckNotFound",
        message: `Deck ${input.deckId} isn't one of your decks. Call list_decks to see their ids.`,
      };
    }
    return {
      kind: "DeckTooSmall",
      message: `Deck needs at least ${failure.minimum} main-board cards to draw a sample.`,
    };
  },
});
