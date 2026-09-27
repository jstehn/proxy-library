import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { Cents, UserId } from "@/shared/kernel";
import { players } from "../../accounts/infrastructure/schema";
import type {
  EconomySettingsRepository,
  PlayerDirectory,
  WalletRepository,
} from "../application/ports";
import type { EconomySettings } from "../domain/economy";
import { economySettings, ledgerEntries, walletAccounts } from "./schema";

const SETTINGS_ROW_ID = 1;

export function drizzleWalletRepository(db: DbExecutor): WalletRepository {
  return {
    async openAccountIfMissing(account) {
      // "on conflict do nothing": if another request opened it first, insert nothing.
      // Only the call that actually inserted gets a row back.
      const inserted = await db
        .insert(walletAccounts)
        .values(account)
        .onConflictDoNothing()
        .returning({ userId: walletAccounts.userId });
      return inserted.length > 0;
    },

    async lockAccount(userId) {
      // SELECT … FOR UPDATE: lock this row until the transaction ends (design doc 03, section 8).
      const [row] = await db
        .select()
        .from(walletAccounts)
        .where(eq(walletAccounts.userId, userId))
        .for("update");
      if (row === undefined) throw new Error(`no wallet account for ${userId}`);
      return { ...row, userId: UserId.of(row.userId) };
    },

    async updateAccount(account) {
      await db
        .update(walletAccounts)
        .set({ allowancePaidThrough: account.allowancePaidThrough })
        .where(eq(walletAccounts.userId, account.userId));
    },

    async appendEntries(entries) {
      if (entries.length === 0) return;
      await db.insert(ledgerEntries).values(
        entries.map((entry) => ({
          userId: entry.userId,
          amountCents: entry.amount,
          kind: entry.kind,
          note: entry.note,
          createdBy: entry.createdBy,
          effectiveAt: entry.effectiveAt,
          ref: entry.ref,
        })),
      );
    },

    async balance(userId) {
      const [row] = await db
        .select({ total: sql`coalesce(sum(${ledgerEntries.amountCents}), 0)`.mapWith(Number) })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.userId, userId));
      return Cents.of(row.total);
    },
  };
}

export function drizzleEconomySettingsRepository(db: DbExecutor): EconomySettingsRepository {
  function toSettings(row: typeof economySettings.$inferSelect): EconomySettings {
    return {
      allowance: Cents.of(row.allowanceCents),
      allowancePeriodDays: row.allowancePeriodDays,
      allowanceAnchor: row.allowanceAnchor,
      startingGrant: Cents.of(row.startingGrantCents),
      selfFundLimit: Cents.of(row.selfFundLimitCents),
    };
  }

  async function load(options: { lock: boolean }): Promise<EconomySettings> {
    const query = db.select().from(economySettings).where(eq(economySettings.id, SETTINGS_ROW_ID));
    const [row] = options.lock ? await query.for("update") : await query;
    if (row === undefined) throw new Error("economy settings are missing: run the migrations");
    return toSettings(row);
  }

  return {
    get: () => load({ lock: false }),
    lockAndGet: () => load({ lock: true }),
    async save(settings, updatedBy) {
      await db
        .update(economySettings)
        .set({
          allowanceCents: settings.allowance,
          allowancePeriodDays: settings.allowancePeriodDays,
          allowanceAnchor: settings.allowanceAnchor,
          startingGrantCents: settings.startingGrant,
          selfFundLimitCents: settings.selfFundLimit,
          updatedAt: sql`now()`,
          updatedBy,
        })
        .where(eq(economySettings.id, SETTINGS_ROW_ID));
    },
  };
}

/** Answers "does this player exist?" from the accounts module's `players` table. */
export function drizzlePlayerDirectory(db: DbExecutor): PlayerDirectory {
  return {
    async exists(userId) {
      const rows = await db
        .select({ userId: players.userId })
        .from(players)
        .where(eq(players.userId, userId));
      return rows.length > 0;
    },
    async allPlayerIds() {
      const rows = await db.select({ userId: players.userId }).from(players);
      return rows.map((row) => UserId.of(row.userId));
    },
  };
}
