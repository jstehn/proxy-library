import type { Finish, PrintingId } from "@/modules/catalog";
import { err, ok, type Brand, type Result, type UserId } from "@/shared/kernel";
import type { NameInvalid, QuantityInvalid } from "./errors";

// The deck builder's vocabulary (design doc 09, section 3).

export type DeckId = Brand<number, "DeckId">;
export const DeckId = {
  of(raw: number): DeckId {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new RangeError(`not a deck id: ${raw}`);
    return raw as DeckId;
  },
};

export const BOARDS = ["commander", "main", "side"] as const;
export type Board = (typeof BOARDS)[number];

export const FORMATS = [
  "casual",
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
  "pauper",
  "commander",
] as const;
export type Format = (typeof FORMATS)[number];

/** A line in a deck: a card (any printing), where it goes, how many, and which version to show. */
export type DeckEntry = Readonly<{
  oracleId: string;
  board: Board;
  quantity: number;
  printingId: PrintingId | null;
  finish: Finish | null;
}>;

export type Deck = Readonly<{
  id: DeckId;
  ownerId: UserId;
  name: string;
  format: Format;
  entries: readonly DeckEntry[];
}>;

export const MAX_DECKS = 100;
export const MAX_NAME_LENGTH = 60;
export const MAX_QUANTITY = 99;

export function checkName(raw: string): Result<string, NameInvalid> {
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return err({ kind: "NameInvalid", maximum: MAX_NAME_LENGTH });
  }
  return ok(name);
}

/** 0 removes the entry; otherwise 1–99 (rule 6). */
export function checkQuantity(quantity: number): Result<number, QuantityInvalid> {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
    return err({ kind: "QuantityInvalid", maximum: MAX_QUANTITY });
  }
  return ok(quantity);
}

/**
 * The deck with one entry set to a quantity (0 removes it). Keeps the entry's pinned printing
 * unless a new one is given.
 */
export function withEntry(
  deck: Deck,
  change: Omit<DeckEntry, "printingId" | "finish"> & {
    printingId?: PrintingId | null;
    finish?: Finish | null;
  },
): Deck {
  const same = (entry: DeckEntry) =>
    entry.oracleId === change.oracleId && entry.board === change.board;
  const existing = deck.entries.find(same);
  const others = deck.entries.filter((entry) => !same(entry));
  if (change.quantity === 0) return { ...deck, entries: others };
  const entry: DeckEntry = {
    oracleId: change.oracleId,
    board: change.board,
    quantity: change.quantity,
    printingId: change.printingId ?? existing?.printingId ?? null,
    finish: change.finish ?? existing?.finish ?? null,
  };
  return { ...deck, entries: [...others, entry] };
}
