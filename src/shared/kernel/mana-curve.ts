// The mana curve (lives in the kernel because both decks and drafts use it): how many spells sit at each mana value. One curve for the whole app (the deck
// builder's): slots 0 to 6, and slot 7 holds everything that costs seven or more.
import { isLand } from "./card-types";

/** The last slot of the curve; it holds this mana value and everything above it. */
export const CURVE_LAST_SLOT = 7;

/** The curve's slots, from 0 to 7+. */
export const CURVE_SLOTS: readonly number[] = Array.from(
  { length: CURVE_LAST_SLOT + 1 },
  (_, slot) => slot,
);

/**
 * The slot a mana value falls in: fractions round down (a half-mana card like Little Girl is 0)
 * and anything from 7 up is the last slot. The mana value is the card's total, so a split card
 * counts both halves and an X in a cost counts as 0, exactly as the catalog stores them.
 */
export function curveSlot(manaValue: number): number {
  return Math.min(CURVE_LAST_SLOT, Math.max(0, Math.floor(manaValue)));
}

/** A slot's name for people: "3", or "7+" for the last one. */
export function curveSlotLabel(slot: number): string {
  return slot >= CURVE_LAST_SLOT ? `${CURVE_LAST_SLOT}+` : String(slot);
}

export type CurveLine = Readonly<{ typeLine: string; manaValue: number; quantity: number }>;

/**
 * How many spells (lands left out) sit in each slot, 8 numbers from 0 to 7+. A card with a land
 * face (a modal double-faced card whose front is a land) counts as a land, so it's not here.
 */
export function manaCurve(lines: readonly CurveLine[]): number[] {
  const curve = CURVE_SLOTS.map(() => 0);
  for (const line of lines) {
    if (isLand(line.typeLine)) continue;
    curve[curveSlot(line.manaValue)] += line.quantity;
  }
  return curve;
}
