import { MAX_WISH_QUANTITY, type Wish, type WishId } from "./wish";

// Wishing for many cards at once, such as everything your decks are short of (task 71). Pure:
// it decides what to add and what to raise, and the use case saves it.

/** A card someone needs, and how many copies of it they want to own in total. */
export type CardNeed = Readonly<{ oracleId: string; quantity: number }>;

/** A wish whose quantity goes up. */
export type RaisedWish = Readonly<{ wishId: WishId; quantity: number }>;

export type CardWishPlan = Readonly<{
  /** New "any printing, cheapest" wishes. */
  add: CardNeed[];
  /** Existing "any printing, cheapest" wishes that wanted fewer copies. */
  raise: RaisedWish[];
  /** Cards already wished for: enough copies, or a printing or finish the player chose. */
  unchanged: number;
  /** Cards left out because the wishlist is full (rule 2). */
  skipped: number;
}>;

/**
 * Decides what wishing for these cards changes. `existing` is the player's wishes for these
 * cards, and `room` is how many more wishes fit on the list.
 */
export function planCardWishes(
  needs: readonly CardNeed[],
  existing: readonly Wish[],
  room: number,
): CardWishPlan {
  const add: CardNeed[] = [];
  const raise: RaisedWish[] = [];
  let unchanged = 0;
  let skipped = 0;

  for (const need of mergeNeeds(needs)) {
    const wishesForCard = existing.filter((wish) => wish.target.oracleId === need.oracleId);
    const cheapest = wishesForCard.find(
      (wish) => wish.target.kind === "anyPrinting" && wish.target.finish === "cheapest",
    );
    if (cheapest !== undefined && cheapest.quantity < need.quantity) {
      raise.push({ wishId: cheapest.id, quantity: need.quantity });
    } else if (wishesForCard.length > 0) {
      // Either enough copies already, or the player chose a finish or printing: keep it.
      unchanged++;
    } else if (add.length < room) {
      add.push(need);
    } else {
      skipped++;
    }
  }
  return { add, raise, unchanged, skipped };
}

/**
 * One need per card, at the largest quantity asked for, capped at what a wish may want
 * (rule 3). Needs of zero copies are dropped.
 */
function mergeNeeds(needs: readonly CardNeed[]): CardNeed[] {
  const quantities = new Map<string, number>();
  for (const need of needs) {
    if (need.quantity <= 0) continue;
    const quantity = Math.min(MAX_WISH_QUANTITY, need.quantity);
    quantities.set(need.oracleId, Math.max(quantities.get(need.oracleId) ?? 0, quantity));
  }
  return [...quantities].map(([oracleId, quantity]) => ({ oracleId, quantity }));
}
