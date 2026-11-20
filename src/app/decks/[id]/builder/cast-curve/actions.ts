"use server";
import { z } from "zod";
import type { CastReport } from "@/modules/decks";
import { action } from "@/server/action-instance";
import { err, ok } from "@/shared/kernel";
import { DeckIdInput, NOT_YOURS } from "../action-helpers";
import { rejected, type Outcome } from "../answer";

// "When can I cast this?": the same capability as the draw_sample tool, for one card.

/** Simulated games per answer: about plus or minus two points, and fast. */
const RUNS = 2000;
const LAST_TURN = 10;

const CastInput = z.object({
  deckId: DeckIdInput,
  /** A card name, or "commander". */
  card: z.string().min(1).max(200),
});

export const castCurveAction = action(
  CastInput,
  async ({ actor, capabilities }, input): Promise<Outcome<CastReport>> => {
    const result = await capabilities.drawSample.castCurves({
      userId: actor.userId,
      deckId: input.deckId,
      cards: [input.card],
      onTheDraw: false,
      lastTurn: LAST_TURN,
      runs: RUNS,
    });
    if (result.ok) return ok(result.value);
    const failure = result.error;
    if (failure.kind === "DeckNotFound") return err(rejected(NOT_YOURS));
    if (failure.kind === "DeckTooSmall") return err(rejected("The deck is too small to simulate."));
    return err(rejected(`${failure.name} isn't in this deck.`));
  },
);
