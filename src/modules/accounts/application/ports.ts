import type { Clock, Result, UnitOfWork, UserId } from "@/shared/kernel";
import type { AccessToken, AccessTokenId, Scope } from "../domain/access-token";
import type { DisplayName, Password, Username } from "../domain/credentials";
import type { InvalidCredentials, UsernameTaken } from "../domain/errors";
import type { Invite, InviteCode } from "../domain/invite";
import type { AuthorizationCode, OAuthClient } from "../domain/oauth";
import type { Player } from "../domain/player";

// Ports: what the accounts use cases need from the outside world, described as interfaces.
// Real implementations live in ../infrastructure, test fakes in ../testing.

/**
 * Credentials and sessions. Implemented with Better Auth (ADR 0012).
 *
 * Methods that deal with "the current browser" take the incoming request's headers,
 * because that is where the session cookie lives. `Headers` is the standard web type.
 */
export interface IdentityProvider {
  createUser(input: {
    username: Username;
    displayName: DisplayName;
    password: Password;
  }): Promise<Result<UserId, UsernameTaken>>;
  /** Only used to undo `createUser` when registration fails after it (a compensating action). */
  deleteUser(userId: UserId): Promise<void>;
  signIn(
    input: { username: Username; password: Password },
    requestHeaders: Headers,
  ): Promise<Result<UserId, InvalidCredentials>>;
  signOut(requestHeaders: Headers): Promise<void>;
  currentUserId(requestHeaders: Headers): Promise<UserId | null>;
  changePassword(
    input: { currentPassword: string; newPassword: Password },
    requestHeaders: Headers,
  ): Promise<Result<void, InvalidCredentials>>;
  /** Admin reset: replace a player's password without knowing the old one. */
  setPassword(userId: UserId, password: Password): Promise<void>;
  endAllSessions(userId: UserId): Promise<void>;
}

/** Our own player data. */
export interface PlayerRepository {
  /**
   * Take the accounts lock for the rest of the transaction, so that registrations and admin
   * changes happen one at a time (design doc 02, section 8).
   */
  lockAccounts(): Promise<void>;
  countPlayers(): Promise<number>;
  countActiveAdmins(): Promise<number>;
  findById(userId: UserId): Promise<Player | null>;
  insert(player: Player): Promise<void>;
  update(player: Player): Promise<void>;
}

export interface InviteRepository {
  insert(invite: Invite): Promise<void>;
  findByCode(code: InviteCode): Promise<Invite | null>;
  update(invite: Invite): Promise<void>;
}

/** Random invite codes and temporary passwords from a secure random source. */
export interface SecretGenerator {
  inviteCode(): InviteCode;
  temporaryPassword(): Password;
  /** 32 random bytes for a new access token (design doc 28), OAuth client id or code (30). */
  accessTokenBytes(): Uint8Array;
}

/** A token as it is first stored: everything but the id, plus the secret's hash. */
export type NewAccessToken = Readonly<{
  userId: UserId;
  name: string;
  prefix: string;
  hash: string;
  scopes: readonly Scope[];
  createdAt: Date;
  /** The OAuth client it was made for (design doc 30), if any. */
  oauthClientId?: string | null;
}>;

/** Personal access tokens (design doc 28, section 6). Only hashes are stored (rule 2). */
export interface AccessTokenRepository {
  /** The player's live tokens, leaving out those made for `exceptClientId` (design doc 30). */
  countLive(userId: UserId, exceptClientId?: string): Promise<number>;
  insert(token: NewAccessToken): Promise<AccessToken>;
  /** The live (not revoked) token with this hash, or null. */
  findLiveByHash(hash: string): Promise<AccessToken | null>;
  /** Revokes one of the player's live tokens; false when it isn't theirs or is already revoked. */
  revoke(id: AccessTokenId, userId: UserId, at: Date): Promise<boolean>;
  /** Revokes every live token of the player; returns how many. */
  revokeAll(userId: UserId, at: Date): Promise<number>;
  touch(id: AccessTokenId, at: Date): Promise<void>;
  /** Revokes the player's live tokens made for one OAuth client (design doc 30, rule 7). */
  revokeForClient(userId: UserId, clientId: string, at: Date): Promise<number>;
}

/** OAuth clients and authorization codes (design doc 30). Codes are stored as hashes. */
export interface OAuthRepository {
  insertClient(client: OAuthClient): Promise<void>;
  findClient(clientId: string): Promise<OAuthClient | null>;
  insertCode(hash: string, code: AuthorizationCode): Promise<void>;
  /** The code with this hash if it's unused and unexpired, marking it used; otherwise null. */
  takeCode(hash: string, now: Date): Promise<AuthorizationCode | null>;
}

/** The repositories that must share one transaction. */
export type AccountsServices = {
  players: PlayerRepository;
  invites: InviteRepository;
  accessTokens: AccessTokenRepository;
  oauth: OAuthRepository;
};

/** Everything the accounts use cases need, passed in by the composition root. */
export type AccountsDependencies = {
  unitOfWork: UnitOfWork<AccountsServices>;
  identity: IdentityProvider;
  secrets: SecretGenerator;
  clock: Clock;
};
