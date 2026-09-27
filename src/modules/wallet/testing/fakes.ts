// In-memory stand-ins for the wallet ports, for fast tests with no database.
// They pass the same contract tests as the real repositories.
import { Cents, UserId } from "@/shared/kernel";
import { inMemoryUnitOfWork } from "@/shared/kernel/testing";
import type {
  EconomySettingsRepository,
  PlayerDirectory,
  WalletRepository,
  WalletServices,
} from "../application/ports";
import type { EconomySettings, WalletAccount } from "../domain/economy";
import type { LedgerEntry } from "../domain/ledger";

export function inMemoryWalletRepository() {
  const accounts = new Map<UserId, WalletAccount>();
  const entries: LedgerEntry[] = [];

  const repository: WalletRepository = {
    async openAccountIfMissing(account) {
      if (accounts.has(account.userId)) return false;
      accounts.set(account.userId, account);
      return true;
    },
    async lockAccount(userId) {
      const account = accounts.get(userId);
      if (account === undefined) throw new Error(`no wallet account for ${userId}`);
      return account;
    },
    async updateAccount(account) {
      accounts.set(account.userId, account);
    },
    async appendEntries(newEntries) {
      for (const entry of newEntries) {
        if (!accounts.has(entry.userId)) throw new Error(`no wallet account for ${entry.userId}`);
        entries.push(entry);
      }
    },
    async balance(userId) {
      return Cents.sum(entries.filter((entry) => entry.userId === userId).map((e) => e.amount));
    },
  };

  return {
    ...repository,
    /** Every entry for one player, oldest first (for test assertions). */
    entriesFor(userId: UserId): LedgerEntry[] {
      return entries.filter((entry) => entry.userId === userId);
    },
  };
}

export const DEFAULT_TEST_SETTINGS: EconomySettings = {
  allowance: Cents.of(2000), // $20
  allowancePeriodDays: 7,
  allowanceAnchor: new Date("2026-01-05T00:00:00Z"), // a Monday
  startingGrant: Cents.of(5000), // $50
  selfFundLimit: Cents.of(10_000), // $100
};

export function inMemoryEconomySettingsRepository(
  initial: EconomySettings = DEFAULT_TEST_SETTINGS,
): EconomySettingsRepository {
  let current = initial;
  return {
    async get() {
      return current;
    },
    async lockAndGet() {
      return current;
    },
    async save(settings) {
      current = settings;
    },
  };
}

export function inMemoryPlayerDirectory(playerIds: string[]): PlayerDirectory {
  const ids = playerIds.map((id) => UserId.of(id));
  return {
    async exists(userId) {
      return ids.includes(userId);
    },
    async allPlayerIds() {
      return [...ids];
    },
  };
}

export function inMemoryWalletServices(playerIds: string[]) {
  const services = {
    wallets: inMemoryWalletRepository(),
    economy: inMemoryEconomySettingsRepository(),
    playerDirectory: inMemoryPlayerDirectory(playerIds),
  };
  return {
    services,
    unitOfWork: inMemoryUnitOfWork<WalletServices>(services),
  };
}
