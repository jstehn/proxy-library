import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import type { InviteRepository, PlayerRepository } from "../application/ports";
import type { DisplayName, Username } from "../domain/credentials";
import type { Invite, InviteCode } from "../domain/invite";
import type { Player } from "../domain/player";
import { authUsers, invites, players } from "./schema";

// An arbitrary but fixed number that names the "accounts" lock (design doc 02, section 8).
// Postgres advisory locks are identified by a number rather than a table row.
const ACCOUNTS_LOCK_ID = 42_001;

/** Players, stored in our `players` table joined with Better Auth's `auth_users`. */
export function drizzlePlayerRepository(db: DbExecutor): PlayerRepository {
  return {
    async lockAccounts() {
      await db.execute(sql`select pg_advisory_xact_lock(${ACCOUNTS_LOCK_ID})`);
    },

    async countPlayers() {
      const [row] = await db.select({ total: count() }).from(players);
      return row.total;
    },

    async countActiveAdmins() {
      const [row] = await db
        .select({ total: count() })
        .from(players)
        .where(and(eq(players.isAdmin, true), isNull(players.disabledAt)));
      return row.total;
    },

    async findById(userId) {
      const [row] = await db
        .select({
          userId: players.userId,
          username: authUsers.username,
          displayName: authUsers.name,
          isAdmin: players.isAdmin,
          canSelfFund: players.canSelfFund,
          disabledAt: players.disabledAt,
          mustChangePassword: players.mustChangePassword,
          joinedAt: players.createdAt,
        })
        .from(players)
        .innerJoin(authUsers, eq(authUsers.id, players.userId))
        .where(eq(players.userId, userId));
      if (row === undefined) return null;
      if (row.username === null) throw new Error(`player ${userId} has no username`);

      const player: Player = {
        userId: UserId.of(row.userId),
        // These were validated when the player registered, so they are trusted here.
        username: row.username as Username,
        displayName: row.displayName as DisplayName,
        isAdmin: row.isAdmin,
        canSelfFund: row.canSelfFund,
        disabledAt: row.disabledAt,
        mustChangePassword: row.mustChangePassword,
        joinedAt: row.joinedAt,
      };
      return player;
    },

    async insert(player) {
      await db.insert(players).values({
        userId: player.userId,
        isAdmin: player.isAdmin,
        canSelfFund: player.canSelfFund,
        disabledAt: player.disabledAt,
        mustChangePassword: player.mustChangePassword,
        createdAt: player.joinedAt,
      });
    },

    async update(player) {
      // Username and display name belong to Better Auth's table and aren't changed here.
      await db
        .update(players)
        .set({
          isAdmin: player.isAdmin,
          canSelfFund: player.canSelfFund,
          disabledAt: player.disabledAt,
          mustChangePassword: player.mustChangePassword,
        })
        .where(eq(players.userId, player.userId));
    },
  };
}

export function drizzleInviteRepository(db: DbExecutor): InviteRepository {
  function toInvite(row: typeof invites.$inferSelect): Invite {
    return {
      code: row.code as InviteCode,
      createdBy: UserId.of(row.createdBy),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      usedBy: row.usedBy === null ? null : UserId.of(row.usedBy),
      usedAt: row.usedAt,
      revokedAt: row.revokedAt,
    };
  }

  return {
    async insert(invite) {
      await db.insert(invites).values(invite);
    },

    async findByCode(code) {
      const [row] = await db.select().from(invites).where(eq(invites.code, code));
      return row === undefined ? null : toInvite(row);
    },

    async update(invite) {
      await db
        .update(invites)
        .set({ usedBy: invite.usedBy, usedAt: invite.usedAt, revokedAt: invite.revokedAt })
        .where(eq(invites.code, invite.code));
    },
  };
}
