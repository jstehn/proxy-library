import { Cents, err, ok, type Result, type UserId } from "@/shared/kernel";
import type { AmountInvalid, InsufficientFunds, NoteInvalid } from "./errors";

/** Why money moved. Later phases add purchases, sell-backs and trades. */
export type LedgerKind = "starting_grant" | "allowance" | "grant" | "correction" | "self_fund";

/** Each kind goes one way only (design doc 03, rule 4). The database checks this too. */
export const DIRECTION: Readonly<Record<LedgerKind, "in" | "out">> = {
  starting_grant: "in",
  allowance: "in",
  grant: "in",
  correction: "out",
  self_fund: "in",
};

/** One change to one player's money. Entries are only ever added, never changed (rule 1). */
export type LedgerEntry = Readonly<{
  userId: UserId;
  amount: Cents; // positive = money in, negative = money out
  kind: LedgerKind;
  note: string | null;
  createdBy: UserId | null; // null for automatic entries (allowance, starting grant)
  effectiveAt: Date; // when it counts; an allowance counts at its payday
}>;

/** The largest amount one entry may move: a guard against typos like an extra zero (rule 5). */
export const MAX_ENTRY_AMOUNT = Cents.of(1_000_000); // $10,000.00
export const MAX_NOTE_LENGTH = 200;

/**
 * Builds an entry, giving the amount the right sign for its kind. `size` is always positive:
 * a correction of $5 is written `size: 500` and stored as -500.
 */
export function ledgerEntry(input: {
  userId: UserId;
  kind: LedgerKind;
  size: Cents;
  note?: string | null;
  createdBy?: UserId | null;
  effectiveAt: Date;
}): LedgerEntry {
  if (input.size <= 0) {
    throw new RangeError(`ledger entry size must be positive, got ${input.size}`);
  }
  return {
    userId: input.userId,
    amount: DIRECTION[input.kind] === "in" ? input.size : Cents.negate(input.size),
    kind: input.kind,
    note: input.note ?? null,
    createdBy: input.createdBy ?? null,
    effectiveAt: input.effectiveAt,
  };
}

/** An amount someone typed for a grant, correction or deposit: positive, at most the maximum. */
export function checkAmount(
  amount: Cents,
  max: Cents = MAX_ENTRY_AMOUNT,
): Result<Cents, AmountInvalid> {
  if (amount <= 0) return err({ kind: "AmountInvalid", reason: "must be more than $0.00" });
  if (amount > max) {
    return err({ kind: "AmountInvalid", reason: `must be at most ${Cents.format(max)}` });
  }
  return ok(amount);
}

/** Notes are trimmed; empty counts as missing. */
export function checkNote(
  raw: string | null | undefined,
  options: { required: boolean },
): Result<string | null, NoteInvalid> {
  const note = (raw ?? "").trim();
  if (note === "") {
    return options.required ? err({ kind: "NoteInvalid", reason: "is required" }) : ok(null);
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return err({ kind: "NoteInvalid", reason: `must be at most ${MAX_NOTE_LENGTH} characters` });
  }
  return ok(note);
}

/** Rule 3: a balance may never go below $0. */
export function checkCanAfford(balance: Cents, required: Cents): Result<void, InsufficientFunds> {
  if (balance < required) return err({ kind: "InsufficientFunds", balance, required });
  return ok();
}
