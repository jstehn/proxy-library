import type { Finish } from "@/modules/catalog";
import { assertNever, Cents, err, ok, UserId, type Brand, type Result } from "@/shared/kernel";
import type { InvalidWish } from "./errors";

// A wish: one card a player wants, how many copies, and which printing (design doc 26,
// section 3). Pure: no database, no clock.

export type WishId = Brand<number, "WishId">;
export const WishId = {
  of(raw: number): WishId {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new RangeError(`not a wish id: ${raw}`);
    return raw as WishId;
  },
};

/** Rule 2: at most this many wishes per player. */
export const MAX_WISHES = 500;
/** Rule 3: how many copies one wish may want. */
export const MAX_WISH_QUANTITY = 99;
/** Rule 3: the highest target price, $100,000. */
export const MAX_TARGET_PRICE = 10_000_000;
export const MAX_NOTE_LENGTH = 200;

/** For an "any printing" wish: nonfoil only, foil only (foil or etched), or whichever is cheaper. */
export type FinishPreference = "nonfoil" | "foil" | "cheapest";
export const FINISH_PREFERENCES: readonly FinishPreference[] = ["nonfoil", "foil", "cheapest"];

/** Which copies would fill the wish. Both kinds know their card (oracle id). */
export type WishTarget =
  | Readonly<{ kind: "anyPrinting"; oracleId: string; finish: FinishPreference }>
  | Readonly<{ kind: "exactPrinting"; oracleId: string; printingId: string; finish: Finish }>;

/** The parts of a wish the player chooses and can change later. */
export type WishDetails = Readonly<{
  /** How many copies you want to own in total. */
  quantity: number;
  /** "Tell me when it's at or below this", or null for no target. */
  targetPrice: Cents | null;
  /** "" for none. */
  note: string;
}>;

export type Wish = WishDetails &
  Readonly<{
    id: WishId;
    userId: UserId;
    target: WishTarget;
    /** The price on the day it was saved, or null if nothing was for sale then. */
    savedPrice: Cents | null;
    createdAt: Date;
  }>;

/** Rule 3: checks what a player typed. The note is trimmed. */
export function checkDetails(details: WishDetails): Result<WishDetails, InvalidWish> {
  const { quantity, targetPrice } = details;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_WISH_QUANTITY) {
    return err({ kind: "InvalidWish", reason: `Want 1 to ${MAX_WISH_QUANTITY} copies.` });
  }
  if (targetPrice !== null && (targetPrice < 1 || targetPrice > MAX_TARGET_PRICE)) {
    return err({ kind: "InvalidWish", reason: "A target price must be $0.01 to $100,000." });
  }
  const note = details.note.trim();
  if (note.length > MAX_NOTE_LENGTH) {
    return err({ kind: "InvalidWish", reason: `A note can be ${MAX_NOTE_LENGTH} characters.` });
  }
  return ok({ quantity, targetPrice, note });
}

/** Rule 1: two targets are the same wish (one row per player). */
export function sameTarget(a: WishTarget, b: WishTarget): boolean {
  if (a.kind === "anyPrinting" && b.kind === "anyPrinting") {
    return a.oracleId === b.oracleId && a.finish === b.finish;
  }
  if (a.kind === "exactPrinting" && b.kind === "exactPrinting") {
    return a.printingId === b.printingId && a.finish === b.finish;
  }
  return false;
}

/** A printing in one finish: what a wish is filled with, or what's for sale. */
export type CopyKind = Readonly<{ oracleId: string; printingId: string; finish: Finish }>;

/** Whether buying this printing in this finish is what the wish asks for. */
export function fits(target: WishTarget, copy: CopyKind): boolean {
  if (target.kind === "exactPrinting") {
    return copy.printingId === target.printingId && copy.finish === target.finish;
  }
  if (copy.oracleId !== target.oracleId) return false;
  const preference = target.finish;
  switch (preference) {
    case "nonfoil":
      return copy.finish === "nonfoil";
    case "foil":
      return copy.finish !== "nonfoil"; // foil or etched
    case "cheapest":
      return true;
    default:
      return assertNever(preference);
  }
}

/** A stack the player owns: one printing in one finish. */
export type OwnedStack = CopyKind & Readonly<{ quantity: number }>;

/**
 * Section 3.1: copies that count toward the wish. Any copy of the card counts for "any
 * printing"; only that printing in that finish counts for an exact one.
 */
export function ownedToward(target: WishTarget, stacks: readonly OwnedStack[]): number {
  return stacks
    .filter((stack) =>
      target.kind === "anyPrinting"
        ? stack.oracleId === target.oracleId
        : stack.printingId === target.printingId && stack.finish === target.finish,
    )
    .reduce((sum, stack) => sum + stack.quantity, 0);
}

/** A wish as the database stores it: an exact printing, or null for any printing. */
export type StoredWish = Readonly<{
  id: number;
  userId: string;
  oracleId: string;
  printingId: string | null;
  finish: string;
  quantity: number;
  targetCents: number | null;
  savedCents: number | null;
  note: string;
  createdAt: Date;
}>;

const FINISHES_OF_A_PRINTING: readonly Finish[] = ["nonfoil", "foil", "etched"];

/** Reads a stored row. A finish the table's CHECK constraint forbids is a defect, so it throws. */
export function wishFromStored(row: StoredWish): Wish {
  const target: WishTarget =
    row.printingId === null
      ? { kind: "anyPrinting", oracleId: row.oracleId, finish: preference(row.finish) }
      : {
          kind: "exactPrinting",
          oracleId: row.oracleId,
          printingId: row.printingId,
          finish: printingFinish(row.finish),
        };
  return {
    id: WishId.of(row.id),
    userId: UserId.of(row.userId),
    target,
    quantity: row.quantity,
    targetPrice: row.targetCents === null ? null : Cents.of(row.targetCents),
    savedPrice: row.savedCents === null ? null : Cents.of(row.savedCents),
    note: row.note,
    createdAt: row.createdAt,
  };
}

function preference(value: string): FinishPreference {
  const found = FINISH_PREFERENCES.find((finish) => finish === value);
  if (found === undefined) throw new Error(`not a finish preference: ${value}`);
  return found;
}

function printingFinish(value: string): Finish {
  const found = FINISHES_OF_A_PRINTING.find((finish) => finish === value);
  if (found === undefined) throw new Error(`not a finish: ${value}`);
  return found;
}
