import { sql } from "drizzle-orm";
import { afterAll } from "vitest";
import { loadConfig } from "@/shared/config";
import { createDatabase } from "@/shared/db";
import { describeRepositoryContracts } from "../testing/repository.contract";
import { drizzleInviteRepository, drizzlePlayerRepository } from "./drizzle-repositories";
import { authUsers } from "./schema";

const { db, close } = createDatabase(loadConfig().databaseUrl);
afterAll(close);

describeRepositoryContracts("drizzle", async () => {
  await db.execute(sql`truncate invites, players, auth_users cascade`);
  return {
    players: drizzlePlayerRepository(db),
    invites: drizzleInviteRepository(db),
    async createIdentity(player) {
      await db.insert(authUsers).values({
        id: player.userId,
        name: player.displayName,
        email: `${player.username}@players.invalid`,
        username: player.username,
      });
    },
  };
});
