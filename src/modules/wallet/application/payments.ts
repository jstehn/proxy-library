import { ok, type Cents, type Result, type UserId } from "@/shared/kernel";
import type { InsufficientFunds } from "../domain/errors";
import { checkCanAfford, ledgerEntry, type LedgerEntry } from "../domain/ledger";
import type { WalletServices } from "./ports";
import { bringUpToDate } from "./refresh";

// Money moving because of something another module did (buying, selling). These run INSIDE the
// caller's transaction, so the money and the thing it paid for are saved together, or not at all
// (design doc 06, rule 3).

export type SpendInput = Readonly<{
  userId: UserId;
  amount: Cents;
  kind: "purchase_sealed" | "purchase_single" | "trade_out";
  note: string | null;
  ref: string; // what it paid for, e.g. "store:42"
  now: Date;
}>;

/** Takes money from a player's wallet, refusing if they can't afford it (wallet rule 3). */
export async function spend(
  services: WalletServices,
  input: SpendInput,
): Promise<Result<LedgerEntry, InsufficientFunds>> {
  // Pays any allowance that's due first, and locks the wallet until the transaction ends, so two
  // purchases at once can't both spend the same money.
  await bringUpToDate(services, input.userId, input.now);
  const canAfford = checkCanAfford(await services.wallets.balance(input.userId), input.amount);
  if (!canAfford.ok) return canAfford;

  const entry = ledgerEntry({
    userId: input.userId,
    kind: input.kind,
    size: input.amount,
    note: input.note,
    effectiveAt: input.now,
    ref: input.ref,
  });
  await services.wallets.appendEntries([entry]);
  return ok(entry);
}

export type ReceiveInput = Readonly<{
  userId: UserId;
  amount: Cents;
  kind: "sellback" | "trade_in";
  note: string | null;
  ref: string;
  now: Date;
}>;

/** Pays money into a player's wallet (selling a card to the store, receiving money in a trade). */
export async function receive(services: WalletServices, input: ReceiveInput): Promise<LedgerEntry> {
  await bringUpToDate(services, input.userId, input.now);
  const entry = ledgerEntry({
    userId: input.userId,
    kind: input.kind,
    size: input.amount,
    note: input.note,
    effectiveAt: input.now,
    ref: input.ref,
  });
  await services.wallets.appendEntries([entry]);
  return entry;
}

/**
 * Brings several wallets up to date and locks them, always in the same order (by user id). Two
 * transactions that each need both of two wallets then queue up instead of each holding one lock
 * and waiting forever for the other (a deadlock). Used by trades (design doc 10, rule 5).
 */
export async function lockWallets(
  services: WalletServices,
  userIds: readonly UserId[],
  now: Date,
): Promise<void> {
  const inOrder = [...new Set(userIds)].sort();
  for (const userId of inOrder) await bringUpToDate(services, userId, now);
}
