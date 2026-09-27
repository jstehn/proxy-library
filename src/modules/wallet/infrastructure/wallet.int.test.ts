// The real wallet use cases against real Postgres: database rules and concurrency.
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { authUsers, players } from "@/modules/accounts/infrastructure/schema";
import { loadConfig } from "@/shared/config";
import { createDatabase, makeDrizzleUnitOfWork } from "@/shared/db";
import { Cents, err, UserId } from "@/shared/kernel";
import { manualClock } from "@/shared/kernel/testing";
import { makeWallet } from "../application/make-wallet";
import { DEFAULT_TEST_SETTINGS } from "../testing/fakes";
import {
  drizzleEconomySettingsRepository,
  drizzlePlayerDirectory,
  drizzleWalletRepository,
} from "./drizzle-repositories";

const { db, close } = createDatabase(loadConfig().databaseUrl);
afterAll(close);

// Wednesday 2026-01-07 10:00 UTC; paydays are Mondays 00:00 UTC (DEFAULT_TEST_SETTINGS).
const clock = manualClock("2026-01-07T10:00:00Z");
const wallet = makeWallet({
  unitOfWork: makeDrizzleUnitOfWork(db, (transaction) => ({
    wallets: drizzleWalletRepository(transaction),
    economy: drizzleEconomySettingsRepository(transaction),
    playerDirectory: drizzlePlayerDirectory(transaction),
  })),
  clock,
});

const admin: Actor = {
  userId: UserId.of("admin"),
  username: "admin" as Actor["username"],
  displayName: "Admin" as Actor["displayName"],
  isAdmin: true,
  canSelfFund: false,
  mustChangePassword: false,
};
const jack = UserId.of("jack");

async function createPlayer(id: string) {
  await db.insert(authUsers).values({ id, name: id, email: `${id}@players.invalid`, username: id });
  await db.insert(players).values({ userId: id, createdAt: new Date("2026-01-01T00:00:00Z") });
}

async function ledgerKinds(userId: UserId): Promise<string[]> {
  const rows = await db.execute<{ kind: string }>(
    sql`select kind from ledger_entries where user_id = ${userId} order by effective_at, id`,
  );
  return rows.rows.map((row) => row.kind);
}

beforeEach(async () => {
  await db.execute(sql`truncate invites, players, auth_users cascade`);
  await drizzleEconomySettingsRepository(db).save(DEFAULT_TEST_SETTINGS, admin.userId);
  clock.set("2026-01-07T10:00:00Z");
  await createPlayer("admin");
  await createPlayer("jack");
});

describe("database rules (design doc 03, rule 4)", () => {
  it("refuses a positive correction, a negative grant, a zero amount and an unknown kind", async () => {
    await wallet.refreshWallet(jack); // opens the wallet, so entries can reference it
    const insert = (kind: string, amount: number) =>
      db.execute(
        sql`insert into ledger_entries (user_id, amount_cents, kind, effective_at)
            values (${jack}, ${amount}, ${kind}, now())`,
      );

    await expect(insert("correction", 500)).rejects.toThrow(/Failed query/);
    await expect(insert("grant", -500)).rejects.toThrow(/Failed query/);
    await expect(insert("grant", 0)).rejects.toThrow(/Failed query/);
    await expect(insert("lottery", 500)).rejects.toThrow(/Failed query/);
    await expect(insert("grant", 500)).resolves.toBeDefined();
  });
});

describe("concurrency (design doc 03, section 8)", () => {
  it("ten simultaneous first visits pay the starting grant exactly once", async () => {
    const balances = await Promise.all(
      Array.from({ length: 10 }, () => wallet.refreshWallet(jack)),
    );
    expect(new Set(balances)).toEqual(new Set([5000]));
    expect(await ledgerKinds(jack)).toEqual(["starting_grant"]);
  });

  it("ten simultaneous visits after three paydays pay each payday exactly once", async () => {
    await wallet.refreshWallet(jack);
    clock.advanceBy(21 * 24 * 60 * 60 * 1000);

    await Promise.all(Array.from({ length: 10 }, () => wallet.refreshWallet(jack)));
    expect(await ledgerKinds(jack)).toEqual([
      "starting_grant",
      "allowance",
      "allowance",
      "allowance",
    ]);
  });

  it("two simultaneous corrections that together exceed the balance: one wins", async () => {
    await wallet.refreshWallet(jack); // $50
    const correct = (note: string) =>
      wallet.correctBalance(admin, { userId: jack, amount: Cents.of(3000), note });

    const results = await Promise.all([correct("first"), correct("second")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      err({ kind: "InsufficientFunds", balance: 2000, required: 3000 }),
    ]);
    expect(await wallet.refreshWallet(jack)).toBe(2000);
  });
});

describe("settings", () => {
  it("pays up under the old allowance before switching to the new one", async () => {
    await wallet.refreshWallet(jack);
    clock.advanceBy(7 * 24 * 60 * 60 * 1000);
    const updated = await wallet.updateEconomySettings(admin, {
      ...DEFAULT_TEST_SETTINGS,
      allowance: Cents.of(3000),
    });
    expect(updated.ok).toBe(true);

    clock.advanceBy(7 * 24 * 60 * 60 * 1000);
    expect(await wallet.refreshWallet(jack)).toBe(5000 + 2000 + 3000);
  });
});
