import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { UserId } from "@/shared/kernel";
import type {
  AccessTokenRepository,
  InviteRepository,
  OAuthRepository,
  PlayerRepository,
} from "../application/ports";
import { AccessTokenId, withRead, type AccessToken } from "../domain/access-token";
import type { DisplayName, Username } from "../domain/credentials";
import type { Invite, InviteCode } from "../domain/invite";
import type { AuthorizationCode, OAuthClient } from "../domain/oauth";
import type { Player } from "../domain/player";
import { accessTokens, authUsers, invites, oauthClients, oauthCodes, players } from "./schema";

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

/** Personal access tokens (design doc 28), in the `access_tokens` table. */
export function drizzleAccessTokenRepository(db: DbExecutor): AccessTokenRepository {
  function toToken(row: typeof accessTokens.$inferSelect): AccessToken {
    return {
      id: AccessTokenId.of(row.id),
      userId: UserId.of(row.userId),
      name: row.name,
      prefix: row.prefix,
      scopes: withRead(row.scopes),
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
    };
  }
  const isLive = isNull(accessTokens.revokedAt);

  return {
    async countLive(userId, exceptClientId) {
      const [row] = await db
        .select({ live: count() })
        .from(accessTokens)
        .where(
          and(
            eq(accessTokens.userId, userId),
            isLive,
            exceptClientId === undefined
              ? undefined
              : sql`${accessTokens.oauthClientId} is distinct from ${exceptClientId}`,
          ),
        );
      return row.live;
    },
    async insert({ hash, ...token }) {
      const [row] = await db
        .insert(accessTokens)
        .values({ ...token, tokenHash: hash, scopes: [...token.scopes] })
        .returning();
      return toToken(row);
    },
    async findLiveByHash(hash) {
      const [row] = await db
        .select()
        .from(accessTokens)
        .where(and(eq(accessTokens.tokenHash, hash), isLive));
      return row === undefined ? null : toToken(row);
    },
    async revoke(id, userId, at) {
      const rows = await db
        .update(accessTokens)
        .set({ revokedAt: at })
        .where(and(eq(accessTokens.id, id), eq(accessTokens.userId, userId), isLive))
        .returning({ id: accessTokens.id });
      return rows.length > 0;
    },
    async revokeAll(userId, at) {
      const rows = await db
        .update(accessTokens)
        .set({ revokedAt: at })
        .where(and(eq(accessTokens.userId, userId), isLive))
        .returning({ id: accessTokens.id });
      return rows.length;
    },
    async touch(id, at) {
      await db.update(accessTokens).set({ lastUsedAt: at }).where(eq(accessTokens.id, id));
    },
    async revokeForClient(userId, clientId, at) {
      const rows = await db
        .update(accessTokens)
        .set({ revokedAt: at })
        .where(
          and(eq(accessTokens.userId, userId), eq(accessTokens.oauthClientId, clientId), isLive),
        )
        .returning({ id: accessTokens.id });
      return rows.length;
    },
  };
}

/** OAuth clients and codes (design doc 30), in `oauth_clients` and `oauth_codes`. */
export function drizzleOAuthRepository(db: DbExecutor): OAuthRepository {
  return {
    async insertClient(client: OAuthClient) {
      await db.insert(oauthClients).values({ ...client, redirectUris: [...client.redirectUris] });
    },
    async findClient(clientId) {
      const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
      return row ?? null;
    },
    async insertCode(hash, code: AuthorizationCode) {
      await db.insert(oauthCodes).values({ ...code, codeHash: hash, scopes: [...code.scopes] });
    },
    async takeCode(hash, now) {
      // One statement, so two swaps of the same code can't both succeed.
      const [row] = await db
        .update(oauthCodes)
        .set({ usedAt: now })
        .where(
          and(
            eq(oauthCodes.codeHash, hash),
            isNull(oauthCodes.usedAt),
            gt(oauthCodes.expiresAt, now),
          ),
        )
        .returning();
      if (row === undefined) return null;
      return {
        clientId: row.clientId,
        userId: UserId.of(row.userId),
        redirectUri: row.redirectUri,
        codeChallenge: row.codeChallenge,
        scopes: withRead(row.scopes),
        expiresAt: row.expiresAt,
      };
    },
  };
}
