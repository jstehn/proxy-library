import { isReservedTitle } from "@/shared/card-search";
import { err, ok, type Result } from "@/shared/kernel";
import type { Deck } from "./deck";
import type { HeadingInvalid, HeadingNotFound, HeadingOrderInvalid } from "./errors";

// A deck's own headings (design doc 34): "Ramp", "Win conditions". A card line has at most one;
// they group the main deck when the deck's grouping is "custom". Pure.

export const MAX_HEADING_LENGTH = 40;
/** The most distinct headings one deck may have. */
export const MAX_HEADINGS = 30;

/**
 * Trimmed, 1–40 characters, starting with a letter, and not a board's name ("Sideboard") or a
 * card type's title ("Creatures"). So a deck's text, read back, gives the same headings
 * (invariants 2 and 4): a list line starting with a digit is a card, and "//" or "#" a comment.
 */
export function checkHeading(raw: string): Result<string, HeadingInvalid> {
  const heading = raw.trim().replace(/\s+/g, " ");
  if (heading.length > MAX_HEADING_LENGTH || !/^\p{L}/u.test(heading) || isReservedTitle(heading)) {
    return err({ kind: "HeadingInvalid", maximum: MAX_HEADING_LENGTH });
  }
  return ok(heading);
}

/**
 * The headings kept consistent with the lines: a heading no line uses drops out, a new one goes
 * last (in the order its lines come), and past MAX_HEADINGS the extra lines lose their heading.
 * Every change to a deck passes through it before saving.
 */
export function tidyHeadings(deck: Deck): Deck {
  const used = new Set<string>();
  for (const entry of deck.entries) if (entry.heading !== null) used.add(entry.heading);
  const order = deck.headings.filter((heading) => used.has(heading));
  for (const heading of used) if (!order.includes(heading)) order.push(heading);
  const kept = order.slice(0, MAX_HEADINGS);
  const entries = deck.entries.map((entry) =>
    entry.heading === null || kept.includes(entry.heading) ? entry : { ...entry, heading: null },
  );
  return { ...deck, entries, headings: kept };
}

/**
 * Every line under `from` moves to `to`: a new name renames it (keeping its place), an existing
 * heading merges the two (at the place of `to`), and null clears it.
 */
export function renamedHeading(
  deck: Deck,
  from: string,
  to: string | null,
): Result<Deck, HeadingNotFound> {
  if (!deck.headings.includes(from)) return err({ kind: "HeadingNotFound" });
  const entries = deck.entries.map((entry) =>
    entry.heading === from ? { ...entry, heading: to } : entry,
  );
  const merging = to !== null && deck.headings.includes(to);
  const headings =
    to === null || merging
      ? deck.headings.filter((heading) => heading !== from)
      : deck.headings.map((heading) => (heading === from ? to : heading));
  return ok({ ...deck, entries, headings });
}

/** The deck's headings in this order, which must name each of them exactly once. */
export function orderedHeadings(
  deck: Deck,
  order: readonly string[],
): Result<Deck, HeadingOrderInvalid> {
  const sameHeadings =
    order.length === deck.headings.length &&
    new Set(order).size === order.length &&
    order.every((heading) => deck.headings.includes(heading));
  if (!sameHeadings) return err({ kind: "HeadingOrderInvalid" });
  return ok({ ...deck, headings: [...order] });
}

/** The order with one heading swapped with its neighbour: the builder's ↑ and ↓ buttons. */
export function headingMoved(
  order: readonly string[],
  heading: string,
  direction: "up" | "down",
): string[] {
  const index = order.indexOf(heading);
  const other = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || other < 0 || other >= order.length) return [...order];
  const moved = [...order];
  [moved[index], moved[other]] = [moved[other], moved[index]];
  return moved;
}
