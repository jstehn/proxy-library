import type { Finish, PrintingId } from "@/modules/catalog";

// The collection's vocabulary (design doc 06, section 3; ADR 0011: printing × finish).

/** Some copies of one printing in one finish, gained or lost. */
export type CardGain = Readonly<{ printingId: PrintingId; finish: Finish; quantity: number }>;

/** Where cards came from, or went to, recorded with every change (rule 7). */
export type AcquisitionSource = "pack" | "deck" | "product" | "store" | "sale" | "trade" | "reset"; // an admin emptied the player's library

/** Why the cards moved: the source, and which thing in that module ("item:12", "store:40"). */
export type Acquisition = Readonly<{ source: AcquisitionSource; ref: string; at: Date }>;

/**
 * Adds up copies of the same printing and finish, so a pack with two copies of a card makes one
 * change of +2. Drops entries whose total is zero. Keeps first-seen order.
 */
export function combineGains(gains: readonly CardGain[]): CardGain[] {
  const totals = new Map<string, CardGain>();
  for (const gain of gains) {
    if (!Number.isSafeInteger(gain.quantity)) {
      throw new RangeError(`quantity must be a whole number, got ${gain.quantity}`);
    }
    const key = `${gain.printingId}/${gain.finish}`;
    const quantity = (totals.get(key)?.quantity ?? 0) + gain.quantity;
    totals.set(key, { ...gain, quantity });
  }
  return [...totals.values()].filter((gain) => gain.quantity !== 0);
}
