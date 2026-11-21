import type { Board } from "@/modules/decks";
import { BOARDS, isCounted } from "@/modules/decks/client";
import { type BracketFlag, type Tag } from "@/shared/mtg";

// The card the builder has selected: what the selected-card sheet shows (design doc 14, 2.2).
// Plain data, so the reducer and the sheet can both use it.

export type Selection = Readonly<{
  oracleId: string;
  printingId: string;
  name: string;
  owned: number;
  /** How many of `owned` are real copies (design doc 16). */
  ownedReal: number;
  /** Copies in this deck per board. */
  inDeck: Readonly<Partial<Record<Board, number>>>;
  /** How many of your other decks use it (ownership is shared between decks). */
  otherDecks: number;
  /** Copies owned that none of your other decks uses (task 42). */
  free: number;
  misfit: "color" | "legality" | null;
  /** The shown printing's latest price, or null if it has none. */
  priceCents: number | null;
  /** The card's roles, read from its rules text (design doc 19). */
  tags: readonly Tag[];
  /** What counts against a Commander bracket (design doc 31). */
  bracketFlags: readonly BracketFlag[];
  /** Format copy limit for this card, or null when unlimited. */
  copyLimit?: number | null;
}>;

/** Copies on the boards that count: every board but the maybeboard (design doc 32). */
export function countedCopies(perBoard: Readonly<Partial<Record<Board, number>>>): number {
  return BOARDS.filter(isCounted).reduce((sum, board) => sum + (perBoard[board] ?? 0), 0);
}
