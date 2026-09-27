import { sql } from "drizzle-orm";
import { afterAll } from "vitest";
import { authUsers, players } from "@/modules/accounts/infrastructure/schema";
import { loadConfig } from "@/shared/config";
import { createDatabase } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import { describeWalletRepositoryContracts } from "../testing/repository.contract";
import { drizzleEconomySettingsRepository, drizzleWalletRepository } from "./drizzle-repositories";

const { db, close } = createDatabase(loadConfig().databaseUrl);
afterAll(close);

/** Creates the rows a wallet depends on: Better Auth's user and our player. */
async function createTestPlayer(id: string): Promise<UserId> {
  await db.insert(authUsers).values({ id, name: id, email: `${id}@players.invalid`, username: id });
  await db.insert(players).values({ userId: id, createdAt: new Date("2026-01-01T00:00:00Z") });
  return UserId.of(id);
}

describeWalletRepositoryContracts("drizzle", async () => {
  await db.execute(sql`truncate invites, players, auth_users cascade`);
  return {
    wallets: drizzleWalletRepository(db),
    economy: drizzleEconomySettingsRepository(db),
    createPlayer: createTestPlayer,
  };
});
