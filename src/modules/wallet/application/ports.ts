import type { Cents, Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type { EconomySettings, WalletAccount } from "../domain/economy";
import type { LedgerEntry } from "../domain/ledger";

// Ports: what the wallet use cases need from outside. Real versions in ../infrastructure,
// in-memory fakes in ../testing.

/** Wallet accounts and the ledger (the write side). */
export interface WalletRepository {
  /**
   * Create the player's wallet account if it doesn't exist yet. Returns true only for the call
   * that actually created it, so exactly one caller pays the starting grant (rule 7), even if two
   * requests open the same wallet at the same moment.
   */
  openAccountIfMissing(account: WalletAccount): Promise<boolean>;
  /** Lock the player's wallet account until the transaction ends, and return it. */
  lockAccount(userId: UserId): Promise<WalletAccount>;
  updateAccount(account: WalletAccount): Promise<void>;
  appendEntries(entries: readonly LedgerEntry[]): Promise<void>;
  balance(userId: UserId): Promise<Cents>;
}

export interface EconomySettingsRepository {
  get(): Promise<EconomySettings>;
  /** Lock the settings until the transaction ends (used while changing them). */
  lockAndGet(): Promise<EconomySettings>;
  save(settings: EconomySettings, updatedBy: UserId): Promise<void>;
}

/** Which players exist. The wallet asks this instead of reaching into the accounts module. */
export interface PlayerDirectory {
  exists(userId: UserId): Promise<boolean>;
  allPlayerIds(): Promise<UserId[]>;
}

/** The repositories that must share one transaction. */
export type WalletServices = {
  wallets: WalletRepository;
  economy: EconomySettingsRepository;
  playerDirectory: PlayerDirectory;
};

export type WalletDependencies = {
  unitOfWork: UnitOfWork<WalletServices>;
  clock: Clock;
};
