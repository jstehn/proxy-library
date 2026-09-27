// Contract tests: what every WalletRepository and EconomySettingsRepository must do.
// Run against the in-memory fakes AND the Drizzle repositories (patterns.md #18).
import { beforeEach, describe, expect, it } from "vitest";
import { Cents, UserId } from "@/shared/kernel";
import type { EconomySettingsRepository, WalletRepository } from "../application/ports";
import type { EconomySettings } from "../domain/economy";
import { ledgerEntry } from "../domain/ledger";

export type WalletRepositoryHarness = {
  wallets: WalletRepository;
  economy: EconomySettingsRepository;
  /** Creates a player the wallet can belong to (a real player row in Postgres). */
  createPlayer(id: string): Promise<UserId>;
};

const opened = new Date("2026-01-01T12:00:00.000Z");

export function describeWalletRepositoryContracts(
  implementation: string,
  setup: () => Promise<WalletRepositoryHarness>,
) {
  let harness: WalletRepositoryHarness;
  let jack: UserId;

  beforeEach(async () => {
    harness = await setup();
    jack = await harness.createPlayer("jack");
  });

  describe(`WalletRepository contract (${implementation})`, () => {
    it("opens an account only once, reporting which call created it", async () => {
      const account = { userId: jack, allowancePaidThrough: opened, openedAt: opened };
      expect(await harness.wallets.openAccountIfMissing(account)).toBe(true);
      expect(await harness.wallets.openAccountIfMissing(account)).toBe(false);
      expect(await harness.wallets.lockAccount(jack)).toEqual(account);
    });

    it("saves how far allowances have been paid", async () => {
      const account = { userId: jack, allowancePaidThrough: opened, openedAt: opened };
      await harness.wallets.openAccountIfMissing(account);
      const later = { ...account, allowancePaidThrough: new Date("2026-02-01T00:00:00.000Z") };
      await harness.wallets.updateAccount(later);
      expect(await harness.wallets.lockAccount(jack)).toEqual(later);
    });

    it("sums entries into a balance, with money out as negative", async () => {
      await harness.wallets.openAccountIfMissing({
        userId: jack,
        allowancePaidThrough: opened,
        openedAt: opened,
      });
      expect(await harness.wallets.balance(jack)).toBe(0);
      await harness.wallets.appendEntries([
        ledgerEntry({ userId: jack, kind: "grant", size: Cents.of(5000), effectiveAt: opened }),
        ledgerEntry({
          userId: jack,
          kind: "correction",
          size: Cents.of(1250),
          effectiveAt: opened,
        }),
      ]);
      expect(await harness.wallets.balance(jack)).toBe(3750);
    });
  });

  describe(`EconomySettingsRepository contract (${implementation})`, () => {
    it("saves and returns settings", async () => {
      const settings: EconomySettings = {
        allowance: Cents.of(1500),
        allowancePeriodDays: 14,
        allowanceAnchor: new Date("2026-03-02T09:00:00.000Z"),
        startingGrant: Cents.of(2500),
        selfFundLimit: Cents.of(4000),
      };
      await harness.economy.save(settings, jack);
      expect(await harness.economy.get()).toEqual(settings);
      expect(await harness.economy.lockAndGet()).toEqual(settings);
    });
  });
}
