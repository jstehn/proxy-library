// How a draft runs (design doc 17, section 3). Only the classic booster draft exists today; cube,
// Rochester or Winston drafts become new rows in this table (the Strategy pattern, as data), so
// the rest of the domain asks the style instead of assuming "three packs, left-right-left".

export const DRAFT_STYLE_NAMES = ["booster"] as const;
export type DraftStyleName = (typeof DRAFT_STYLE_NAMES)[number];

export type PassDirection = "left" | "right";

export type DraftStyle = Readonly<{
  /** How many packs each player opens: one per round. */
  packsPerPlayer: number;
  /** Which way packs travel in a round (rounds count from 1). */
  passDirection(round: number): PassDirection;
}>;

const boosterDraft: DraftStyle = {
  packsPerPlayer: 3,
  passDirection: (round) => (round % 2 === 0 ? "right" : "left"),
};

export const DRAFT_STYLES: Readonly<Record<DraftStyleName, DraftStyle>> = {
  booster: boosterDraft,
};

/**
 * The seat a pack goes to next. Seats sit in a circle numbered 0…n-1: passing left goes to the
 * next number, passing right to the previous one. With two players both are the same seat.
 */
export function passTarget(seat: number, direction: PassDirection, seatCount: number): number {
  const step = direction === "left" ? 1 : -1;
  // `%` in JavaScript keeps the sign of the left side (-1 % 4 is -1, not 3 as in Python),
  // so add seatCount before taking the remainder.
  return (seat + step + seatCount) % seatCount;
}

/**
 * Boosters made for drafting: Play Boosters (2024 on), Draft Boosters before them, and older
 * sets' only booster ("default"). Set, Collector and Jumpstart boosters aren't drafted.
 */
export const DRAFTABLE_BOOSTER_TYPES: readonly string[] = ["play", "draft", "default"];
