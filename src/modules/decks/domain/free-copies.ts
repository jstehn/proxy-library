import type { Board } from "./deck";

// Free copies (task 42). Ownership is shared between decks: every deck counts all the copies you
// own. A copy is "free" when none of your other decks uses it. Taking a card from another deck
// frees its copies for this one. Pure: counts in, counts out.

/** How many copies of a card one deck has on one board. */
export type BoardCount = Readonly<{ board: Board; quantity: number }>;

/** The order copies are taken from another deck: the sideboard before the main deck. */
const TAKE_ORDER: readonly Board[] = ["side", "main"];

/**
 * How many copies to take from another deck so this one has `wanted` copies free. `free` is how
 * many are free already and `available` how many that deck can give. Zero when enough are free.
 */
export function copiesToTake(wanted: number, free: number, available: number): number {
  return Math.max(Math.min(wanted - free, available), 0);
}

/**
 * The other deck's new count on each board it loses copies from, after taking `count` copies:
 * the sideboard first, then the main deck, never the commander. Boards that don't change aren't
 * listed.
 */
export function takeCopies(counts: readonly BoardCount[], count: number): BoardCount[] {
  const changes: BoardCount[] = [];
  let left = count;
  for (const board of TAKE_ORDER) {
    const current = counts
      .filter((entry) => entry.board === board)
      .reduce((total, entry) => total + entry.quantity, 0);
    if (left <= 0 || current === 0) continue;
    const taken = Math.min(left, current);
    changes.push({ board, quantity: current - taken });
    left -= taken;
  }
  return changes;
}
