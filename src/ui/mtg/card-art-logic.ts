// Pure helpers for the interactive card stage: two-sided face resolution, carousel index
// wrapping, and horizontal swipe detection (design doc 73).

export type CardFaceSide = "front" | "back";

export type CardStepping = Readonly<{
  /** 1-based position in the sequence (0 when pack opener has no card revealed yet). */
  position: number;
  total: number;
  /** Defaults to `total > 1`. */
  canGoPrevious?: boolean;
  /** Defaults to `total > 1`. */
  canGoNext?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}>;

export type FaceSelection = Readonly<{
  printingId: string;
  face: CardFaceSide;
}>;

/**
 * Resolves which face to display for the current card. Switching to a different printing or
 * viewing a single-faced card always resets to "front" without needing an effect.
 */
export function resolveCardFace(
  selection: FaceSelection | null,
  printingId: string,
  hasBackImage: boolean,
): CardFaceSide {
  if (!hasBackImage || selection === null || selection.printingId !== printingId) {
    return "front";
  }
  return selection.face;
}

/** Toggles between front and back for the current printing. */
export function toggleCardFace(
  selection: FaceSelection | null,
  printingId: string,
  hasBackImage: boolean,
): FaceSelection {
  if (!hasBackImage) return { printingId, face: "front" };
  const current = resolveCardFace(selection, printingId, hasBackImage);
  return { printingId, face: current === "front" ? "back" : "front" };
}

/** Steps an index forward or backward, wrapping around the ends of a non-empty list. */
export function wrapIndex(current: number, delta: 1 | -1, total: number): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}

const SWIPE_THRESHOLD_PX = 44;
const SWIPE_DIRECTION_RATIO = 1.25;

/**
 * Interprets a touch drag as a carousel step when the movement is clearly horizontal and
 * exceeds the threshold, so vertical scrolling never accidentally changes cards.
 */
export function detectSwipeDirection(deltaX: number, deltaY: number): "previous" | "next" | null {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absX < SWIPE_THRESHOLD_PX) return null;
  if (absX <= absY * SWIPE_DIRECTION_RATIO) return null;
  return deltaX > 0 ? "previous" : "next";
}
