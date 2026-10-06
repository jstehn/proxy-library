import { desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { Cents, type UserId } from "@/shared/kernel";
import { authUsers, players } from "../../accounts/infrastructure/schema";
import type { EconomySettings } from "../domain/economy";
import type { LedgerKind } from "../domain/ledger";
import { economySettings, ledgerEntries, walletAccounts } from "../infrastructure/schema";

// Read models (ADR 0006): one query each, SQL aggregates, plain objects out.

/** Ledger kinds that count as spending. */
const SPENDING_KINDS = sql`('purchase_sealed', 'purchase_single')`;

/** Sum of amounts for entries matching a SQL condition, as a number of cents (0 when none). */
const totalWhere = (condition: ReturnType<typeof sql>) =>
  sql`coalesce(sum(${ledgerEntries.amountCents}) filter (where ${condition}), 0)`.mapWith(Number);

/**
 * Entries after the player's last library reset (design doc 12): totals start again from zero
 * then, while the balance still sums everything. Needs `wallet_accounts` joined.
 */
const AFTER_RESET = sql`(${walletAccounts.totalsSince} is null or ${ledgerEntries.effectiveAt} > ${walletAccounts.totalsSince})`;

/** Like `totalWhere`, counting only entries since the last reset. */
const totalSinceReset = (condition: ReturnType<typeof sql>) =>
  totalWhere(sql`${condition} and ${AFTER_RESET}`);

export type WalletSummary = Readonly<{
  balance: Cents;
  received: Cents; // starting grant + allowances + grants
  selfFunded: Cents;
  spent: Cents; // shown as a positive number
  sold: Cents; // paid by the store for cards sold to it
  corrected: Cents; // shown as a positive number
  /** When the totals above restarted (the last library reset), or null: they count everything. */
  totalsSince: string | null;
}>;

export async function walletSummary(db: DbExecutor, userId: UserId): Promise<WalletSummary> {
  const [row] = await db
    .select({
      balance: sql`coalesce(sum(${ledgerEntries.amountCents}), 0)`.mapWith(Number),
      received: totalSinceReset(
        sql`${ledgerEntries.kind} in ('starting_grant', 'allowance', 'grant')`,
      ),
      selfFunded: totalSinceReset(sql`${ledgerEntries.kind} = 'self_fund'`),
      spent: totalSinceReset(sql`${ledgerEntries.kind} in ${SPENDING_KINDS}`),
      sold: totalSinceReset(sql`${ledgerEntries.kind} = 'sellback'`),
      corrected: totalSinceReset(sql`${ledgerEntries.kind} = 'correction'`),
    })
    .from(ledgerEntries)
    .leftJoin(walletAccounts, eq(walletAccounts.userId, ledgerEntries.userId))
    .where(eq(ledgerEntries.userId, userId));
  const [account] = await db
    .select({ totalsSince: walletAccounts.totalsSince })
    .from(walletAccounts)
    .where(eq(walletAccounts.userId, userId));

  return {
    balance: Cents.of(row.balance),
    received: Cents.of(row.received),
    selfFunded: Cents.of(row.selfFunded),
    spent: Cents.of(-row.spent),
    sold: Cents.of(row.sold),
    corrected: Cents.of(-row.corrected),
    totalsSince: account?.totalsSince?.toISOString() ?? null,
  };
}

export type WalletHistoryItem = Readonly<{
  id: number;
  kind: LedgerKind;
  amount: Cents;
  note: string | null;
  createdByUsername: string | null;
  effectiveAt: string; // ISO date, so it can be passed to client components
}>;

export async function walletHistory(
  db: DbExecutor,
  userId: UserId,
  limit = 100,
): Promise<WalletHistoryItem[]> {
  const rows = await db
    .select({
      id: ledgerEntries.id,
      kind: ledgerEntries.kind,
      amount: ledgerEntries.amountCents,
      note: ledgerEntries.note,
      createdByUsername: authUsers.username,
      effectiveAt: ledgerEntries.effectiveAt,
    })
    .from(ledgerEntries)
    .leftJoin(authUsers, eq(authUsers.id, ledgerEntries.createdBy))
    .where(eq(ledgerEntries.userId, userId))
    .orderBy(desc(ledgerEntries.effectiveAt), desc(ledgerEntries.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    // The database only allows known kinds (a CHECK constraint), so this is safe.
    kind: row.kind as LedgerKind,
    amount: Cents.of(row.amount),
    note: row.note,
    createdByUsername: row.createdByUsername,
    effectiveAt: row.effectiveAt.toISOString(),
  }));
}

export type PlayerMoney = Readonly<{
  userId: string;
  balance: Cents;
  spent: Cents;
  selfFunded: Cents;
  hasWallet: boolean;
}>;

/** Money totals for every player, for the admin Players page. */
export async function playerMoney(db: DbExecutor): Promise<PlayerMoney[]> {
  const rows = await db
    .select({
      userId: players.userId,
      entryCount: sql`count(${ledgerEntries.id})`.mapWith(Number),
      balance: sql`coalesce(sum(${ledgerEntries.amountCents}), 0)`.mapWith(Number),
      spent: totalSinceReset(sql`${ledgerEntries.kind} in ${SPENDING_KINDS}`),
      sold: totalSinceReset(sql`${ledgerEntries.kind} = 'sellback'`),
      selfFunded: totalSinceReset(sql`${ledgerEntries.kind} = 'self_fund'`),
    })
    .from(players)
    .leftJoin(ledgerEntries, eq(ledgerEntries.userId, players.userId))
    .leftJoin(walletAccounts, eq(walletAccounts.userId, players.userId))
    .groupBy(players.userId);

  return rows.map((row) => ({
    userId: row.userId,
    balance: Cents.of(row.balance),
    spent: Cents.of(-row.spent),
    sold: Cents.of(row.sold),
    selfFunded: Cents.of(row.selfFunded),
    hasWallet: row.entryCount > 0,
  }));
}

export async function currentEconomySettings(db: DbExecutor): Promise<EconomySettings> {
  const [row] = await db.select().from(economySettings).where(eq(economySettings.id, 1));
  if (row === undefined) throw new Error("economy settings are missing: run the migrations");
  return {
    allowance: Cents.of(row.allowanceCents),
    allowancePeriodDays: row.allowancePeriodDays,
    allowanceAnchor: row.allowanceAnchor,
    startingGrant: Cents.of(row.startingGrantCents),
    selfFundLimit: Cents.of(row.selfFundLimitCents),
  };
}
