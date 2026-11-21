import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { DeckNotFound } from "@/modules/decks/core/client";
import type { ManaBasePlanWithCastability } from "../domain/mana-base";

// A rough starting land skeleton for a deck: land count, colour sources, which lands to add.

export type DeckManaPlanReaders = Readonly<{
  /** The plan, or null when the deck isn't the player's. */
  plan(userId: UserId, deckId: number): Promise<ManaBasePlanWithCastability | null>;
}>;

export function makeDeckManaPlan(readers: DeckManaPlanReaders) {
  async function deckManaPlan(
    request: Readonly<{ userId: UserId; deckId: number }>,
  ): Promise<Result<ManaBasePlanWithCastability, DeckNotFound>> {
    const plan = await readers.plan(request.userId, request.deckId);
    if (plan === null) return err({ kind: "DeckNotFound" });
    return ok(plan);
  }
  return deckManaPlan;
}
