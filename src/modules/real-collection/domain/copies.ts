import type { Finish, PrintingId } from "@/modules/catalog";

// The real collection's vocabulary (design doc 16, section 4; ADR 0011: printing × finish).

/** Rule 3: at most this many copies of one printing in one finish. */
export const MAX_REAL_QUANTITY = 9999;

/** Which row of the real collection: a printing in a finish. */
export type RealCopyKey = Readonly<{ printingId: PrintingId; finish: Finish }>;

/** One row of the real collection: some copies of a printing in a finish. */
export type RealCopy = RealCopyKey & Readonly<{ quantity: number }>;

/** "printing/finish": a key for maps of copies. */
export function copyKey(key: RealCopyKey): string {
  return `${key.printingId}/${key.finish}`;
}

/** Rule 3: a whole number from 0 (delete the row) to the maximum. */
export function isValidQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= MAX_REAL_QUANTITY;
}

/**
 * Adds up copies of the same printing and finish (a list may name a card twice), keeping
 * first-seen order and never going over the maximum.
 */
export function sumCopies(copies: readonly RealCopy[]): RealCopy[] {
  const totals = new Map<string, RealCopy>();
  for (const copy of copies) {
    const key = copyKey(copy);
    const quantity = Math.min(MAX_REAL_QUANTITY, (totals.get(key)?.quantity ?? 0) + copy.quantity);
    totals.set(key, { printingId: copy.printingId, finish: copy.finish, quantity });
  }
  return [...totals.values()].filter((copy) => copy.quantity > 0);
}
