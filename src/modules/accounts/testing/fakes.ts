// In-memory stand-ins for the accounts ports, for fast tests with no database.
// The in-memory repositories pass the same contract tests as the real ones.
import { err, ok, UserId } from "@/shared/kernel";
import { inMemoryUnitOfWork } from "@/shared/kernel/testing";
import type { Password, Username } from "../domain/credentials";
import type { Invite, InviteCode } from "../domain/invite";
import type { Player } from "../domain/player";
import { AccessTokenId, type AccessToken } from "../domain/access-token";
import type { AuthorizationCode, OAuthClient } from "../domain/oauth";
import type {
  AccessTokenRepository,
  AccountsServices,
  IdentityProvider,
  InviteRepository,
  OAuthRepository,
  PlayerRepository,
  SecretGenerator,
} from "../application/ports";

export function inMemoryPlayerRepository(): PlayerRepository {
  const players = new Map<UserId, Player>();

  return {
    async lockAccounts() {
      // Nothing to lock: in-memory tests run one step at a time.
    },
    async countPlayers() {
      return players.size;
    },
    async countActiveAdmins() {
      return [...players.values()].filter((player) => player.isAdmin && player.disabledAt === null)
        .length;
    },
    async findById(userId) {
      return players.get(userId) ?? null;
    },
    async insert(player) {
      if (players.has(player.userId)) throw new Error(`player ${player.userId} already exists`);
      players.set(player.userId, player);
    },
    async update(player) {
      if (!players.has(player.userId)) throw new Error(`player ${player.userId} does not exist`);
      players.set(player.userId, player);
    },
  };
}

export function inMemoryInviteRepository(): InviteRepository {
  const invites = new Map<InviteCode, Invite>();

  return {
    async insert(invite) {
      if (invites.has(invite.code)) throw new Error(`invite ${invite.code} already exists`);
      invites.set(invite.code, invite);
    },
    async findByCode(code) {
      return invites.get(code) ?? null;
    },
    async update(invite) {
      if (!invites.has(invite.code)) throw new Error(`invite ${invite.code} does not exist`);
      invites.set(invite.code, invite);
    },
  };
}

export function inMemoryAccessTokenRepository(): AccessTokenRepository {
  type Stored = { token: AccessToken; hash: string; clientId: string | null };
  const tokens = new Map<AccessTokenId, Stored>();
  let nextId = 1;
  const live = () => [...tokens.values()].filter((stored) => stored.token.revokedAt === null);

  return {
    async countLive(userId, exceptClientId) {
      return live().filter(
        (stored) =>
          stored.token.userId === userId &&
          (exceptClientId === undefined || stored.clientId !== exceptClientId),
      ).length;
    },
    async insert({ hash, oauthClientId, ...rest }) {
      const token: AccessToken = {
        ...rest,
        id: AccessTokenId.of(nextId++),
        lastUsedAt: null,
        revokedAt: null,
      };
      tokens.set(token.id, { token, hash, clientId: oauthClientId ?? null });
      return token;
    },
    async findLiveByHash(hash) {
      return live().find((stored) => stored.hash === hash)?.token ?? null;
    },
    async revoke(id, userId, at) {
      const stored = tokens.get(id);
      if (
        stored === undefined ||
        stored.token.userId !== userId ||
        stored.token.revokedAt !== null
      ) {
        return false;
      }
      tokens.set(id, { ...stored, token: { ...stored.token, revokedAt: at } });
      return true;
    },
    async revokeAll(userId, at) {
      const mine = live().filter((stored) => stored.token.userId === userId);
      for (const stored of mine) {
        tokens.set(stored.token.id, { ...stored, token: { ...stored.token, revokedAt: at } });
      }
      return mine.length;
    },
    async touch(id, at) {
      const stored = tokens.get(id);
      if (stored !== undefined) {
        tokens.set(id, { ...stored, token: { ...stored.token, lastUsedAt: at } });
      }
    },
    async revokeForClient(userId, clientId, at) {
      const theirs = live().filter(
        (stored) => stored.token.userId === userId && stored.clientId === clientId,
      );
      for (const stored of theirs) {
        tokens.set(stored.token.id, { ...stored, token: { ...stored.token, revokedAt: at } });
      }
      return theirs.length;
    },
  };
}

export function inMemoryOAuthRepository(): OAuthRepository {
  const clients = new Map<string, OAuthClient>();
  const codes = new Map<string, { code: AuthorizationCode; used: boolean }>();

  return {
    async insertClient(client) {
      clients.set(client.clientId, client);
    },
    async findClient(clientId) {
      return clients.get(clientId) ?? null;
    },
    async insertCode(hash, code) {
      codes.set(hash, { code, used: false });
    },
    async takeCode(hash, now) {
      const stored = codes.get(hash);
      if (stored === undefined || stored.used || stored.code.expiresAt <= now) return null;
      codes.set(hash, { ...stored, used: true });
      return stored.code;
    },
  };
}

const SESSION_HEADER = "x-test-session";

/**
 * A pretend Better Auth. Sessions are identified by an `x-test-session` request header
 * instead of a cookie; use `headersFor(userId)` to act as a signed-in browser.
 */
export function inMemoryIdentityProvider() {
  const users = new Map<UserId, { username: Username; password: Password }>();
  const sessions = new Map<string, UserId>();
  const deletedUserIds: UserId[] = [];
  let nextId = 1;

  function startSession(userId: UserId): string {
    const token = `session-${sessions.size + 1}-${userId}`;
    sessions.set(token, userId);
    return token;
  }

  function userIdFrom(requestHeaders: Headers): UserId | null {
    const token = requestHeaders.get(SESSION_HEADER);
    return token === null ? null : (sessions.get(token) ?? null);
  }

  const identity: IdentityProvider = {
    async createUser({ username, password }) {
      const taken = [...users.values()].some((user) => user.username === username);
      if (taken) return err({ kind: "UsernameTaken" });
      const userId = UserId.of(`user-${nextId++}`);
      users.set(userId, { username, password });
      return ok(userId);
    },
    async deleteUser(userId) {
      users.delete(userId);
      deletedUserIds.push(userId);
    },
    async signIn({ username, password }) {
      for (const [userId, user] of users) {
        if (user.username === username && user.password === password) {
          startSession(userId);
          return ok(userId);
        }
      }
      return err({ kind: "InvalidCredentials" });
    },
    async signOut(requestHeaders) {
      const token = requestHeaders.get(SESSION_HEADER);
      if (token !== null) sessions.delete(token);
    },
    async currentUserId(requestHeaders) {
      return userIdFrom(requestHeaders);
    },
    async changePassword({ currentPassword, newPassword }, requestHeaders) {
      const userId = userIdFrom(requestHeaders);
      const user = userId === null ? undefined : users.get(userId);
      if (userId === null || user === undefined || user.password !== currentPassword) {
        return err({ kind: "InvalidCredentials" });
      }
      users.set(userId, { ...user, password: newPassword });
      return ok();
    },
    async setPassword(userId, password) {
      const user = users.get(userId);
      if (user !== undefined) users.set(userId, { ...user, password });
    },
    async endAllSessions(userId) {
      for (const [token, owner] of sessions) {
        if (owner === userId) sessions.delete(token);
      }
    },
  };

  return {
    ...identity,
    /** Request headers for a browser signed in as `userId` (starts a new session). */
    headersFor(userId: UserId): Headers {
      return new Headers({ [SESSION_HEADER]: startSession(userId) });
    },
    passwordOf(userId: UserId): string | undefined {
      return users.get(userId)?.password;
    },
    activeSessionCount(userId: UserId): number {
      return [...sessions.values()].filter((owner) => owner === userId).length;
    },
    deletedUserIds,
  };
}

/** Predictable "random" codes: AAAA-AAAA-0001, AAAA-AAAA-0002, … and temp-password-1, … */
export function sequentialSecretGenerator(): SecretGenerator {
  let inviteCount = 0;
  let passwordCount = 0;
  let tokenCount = 0;

  return {
    inviteCode() {
      inviteCount += 1;
      return `AAAA-AAAA-${String(inviteCount).padStart(4, "0")}` as InviteCode;
    },
    temporaryPassword() {
      passwordCount += 1;
      return `temp-password-${passwordCount}` as Password;
    },
    accessTokenBytes() {
      tokenCount += 1;
      return new Uint8Array(32).fill(tokenCount);
    },
  };
}

/** One in-memory set of accounts services, shared by a test's unit of work. */
export function inMemoryAccountsServices(): AccountsServices {
  return {
    players: inMemoryPlayerRepository(),
    invites: inMemoryInviteRepository(),
    accessTokens: inMemoryAccessTokenRepository(),
    oauth: inMemoryOAuthRepository(),
  };
}

export function inMemoryAccountsUnitOfWork(
  services: AccountsServices = inMemoryAccountsServices(),
) {
  return inMemoryUnitOfWork(services);
}
