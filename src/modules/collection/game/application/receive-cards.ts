import type { UserId } from "@/shared/kernel";
import { combineGains, type Acquisition, type CardGain } from "../domain/cards";
import type { CardGainBatch, CollectionServices } from "./ports";

/**
 * Puts cards into a player's collection, inside the caller's transaction (opening a pack,
 * buying a single, a trade). Every change is logged with its source (design doc 06, rule 7).
 */
export async function receiveCards(
  services: CollectionServices,
  userId: UserId,
  gains: readonly CardGain[],
  acquisition: Acquisition,
): Promise<void> {
  const combined = combineGains(gains);
  if (combined.some((gain) => gain.quantity < 0)) {
    throw new RangeError("receiveCards only adds cards; removing them is a separate operation");
  }
  if (combined.length > 0) await services.collection.receive(userId, combined, acquisition);
}

/** Batched version of `receiveCards` for multi-pack openings: one upsert + one log insert. */
export async function receiveCardBatches(
  services: CollectionServices,
  userId: UserId,
  batches: readonly CardGainBatch[],
): Promise<void> {
  const normalized: CardGainBatch[] = [];
  for (const batch of batches) {
    const combined = combineGains(batch.gains);
    if (combined.some((gain) => gain.quantity < 0)) {
      throw new RangeError("receiveCards only adds cards; removing them is a separate operation");
    }
    if (combined.length > 0) {
      normalized.push({ gains: combined, acquisition: batch.acquisition });
    }
  }
  if (normalized.length > 0) await services.collection.receiveBatch(userId, normalized);
}
