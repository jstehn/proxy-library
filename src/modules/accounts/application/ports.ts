import type { Clock, Result, UnitOfWork, UserId } from "@/shared/kernel";
import type { DisplayName, Password, Username } from "../domain/credentials";
import type { InvalidCredentials, UsernameTaken } from "../domain/errors";
import type { Invite, InviteCode } from "../domain/invite";
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
}

/** The repositories that must share one transaction. */
export type AccountsServices = {
  players: PlayerRepository;
  invites: InviteRepository;
};

/** Everything the accounts use cases need, passed in by the composition root. */
export type AccountsDependencies = {
  unitOfWork: UnitOfWork<AccountsServices>;
  identity: IdentityProvider;
  secrets: SecretGenerator;
  clock: Clock;
};
