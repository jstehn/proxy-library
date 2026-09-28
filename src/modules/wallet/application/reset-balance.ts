import { Cents, type UserId } from "@/shared/kernel";
import { ledgerEntry } from "../domain/ledger";
import type { WalletServices } from "./ports";
import { bringUpToDate } from "./refresh";

export type ResetBalanceInput = Readonly<{
  userId: UserId;
  resetBy: UserId; // the admin
  note: string;
  now: Date;
}>;

/**
 * Sets a player's balance back to the starting grant, inside the caller's transaction (an admin
 * resetting a player). Nothing is deleted (rule 1): one grant or correction makes up the
 * difference, with a note. Returns the new balance.
 */
export async function resetBalance(
  services: WalletServices,
  input: ResetBalanceInput,
): Promise<Cents> {
  await bringUpToDate(services, input.userId, input.now); // also locks the wallet
  const target = (await services.economy.get()).startingGrant;
  const balance = await services.wallets.balance(input.userId);
  if (balance !== target) {
    const entry = ledgerEntry({
      userId: input.userId,
      kind: balance < target ? "grant" : "correction",
      size: Cents.of(Math.abs(target - balance)),
      note: input.note,
      createdBy: input.resetBy,
      effectiveAt: input.now,
    });
    await services.wallets.appendEntries([entry]);
  }
  return target;
}
