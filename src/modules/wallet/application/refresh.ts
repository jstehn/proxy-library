import { ok, type Cents, type Result, type UserId } from "@/shared/kernel";
import { paydaysBetween, type EconomySettings } from "../domain/economy";
import { ledgerEntry, type LedgerEntry } from "../domain/ledger";
import type { WalletDependencies, WalletServices } from "./ports";

/**
 * Brings one wallet up to date, inside the caller's transaction (design doc 03, section 5):
 * opens it if new (paying the starting grant once), then pays every allowance that is due.
 * Every use case that touches money calls this first, so it always sees a current balance.
 *
 * Leaves the player's wallet row LOCKED until the transaction ends.
 */
export async function bringUpToDate(
  services: WalletServices,
  userId: UserId,
  now: Date,
  settingsOverride?: EconomySettings, // used while settings are being changed
): Promise<void> {
  const { wallets, economy } = services;

  const isNew = await wallets.openAccountIfMissing({
    userId,
    allowancePaidThrough: now, // rule 8: allowances start from the moment the wallet opens
    openedAt: now,
  });
  const account = await wallets.lockAccount(userId);
  // Read the settings only after taking the lock, so a settings change that finished while we
  // waited is already visible.
  const settings = settingsOverride ?? (await economy.get());

  const entries: LedgerEntry[] = [];
  if (isNew && settings.startingGrant > 0) {
    entries.push(
      ledgerEntry({
        userId,
        kind: "starting_grant",
        size: settings.startingGrant,
        effectiveAt: now,
      }),
    );
  }

  const schedule = { anchor: settings.allowanceAnchor, periodDays: settings.allowancePeriodDays };
  const duePaydays = paydaysBetween(schedule, account.allowancePaidThrough, now);
  if (settings.allowance > 0) {
    for (const payday of duePaydays) {
      entries.push(
        ledgerEntry({ userId, kind: "allowance", size: settings.allowance, effectiveAt: payday }),
      );
    }
  }

  if (entries.length > 0) await wallets.appendEntries(entries);
  if (account.allowancePaidThrough.getTime() < now.getTime()) {
    await wallets.updateAccount({ ...account, allowancePaidThrough: now });
  }
}

/** Brings a player's wallet up to date and returns their balance. Called when a page shows money. */
export function makeRefreshWallet(dependencies: WalletDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function refreshWallet(userId: UserId): Promise<Cents> {
    const result = await unitOfWork.run<Cents, never>(async (services) => {
      await bringUpToDate(services, userId, clock.now());
      return ok(await services.wallets.balance(userId));
    });
    return unwrap(result);
  }

  return refreshWallet;
}

/** Brings every player's wallet up to date (opening any that are new). Used by admin pages. */
export function makeRefreshAllWallets(dependencies: WalletDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function refreshAllWallets(): Promise<void> {
    // One short transaction per player, so one busy wallet never holds up the others.
    const playerIds = unwrap(
      await unitOfWork.run<UserId[], never>(async ({ playerDirectory }) =>
        ok(await playerDirectory.allPlayerIds()),
      ),
    );
    for (const userId of playerIds) {
      await unitOfWork.run<void, never>(async (services) => {
        await bringUpToDate(services, userId, clock.now());
        return ok();
      });
    }
  }

  return refreshAllWallets;
}

/** For transactions that can't fail in an expected way (their error type is `never`). */
function unwrap<T>(result: Result<T, never>): T {
  if (!result.ok) throw new Error("unreachable: a Result<T, never> can't be an error");
  return result.value;
}
