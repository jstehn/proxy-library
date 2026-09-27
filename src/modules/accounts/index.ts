// The accounts module's public API: the only file other modules and the app may import.
export { makeAccounts } from "./application/make-accounts";
export type { Accounts } from "./application/make-accounts";
export type {
  AccountsDependencies,
  AccountsServices,
  IdentityProvider,
  InviteRepository,
  PlayerRepository,
  SecretGenerator,
} from "./application/ports";
export type { RegisterPlayerError, RegisterPlayerInput } from "./application/register-player";
export type { SignInError } from "./application/sign-in";
export type { ChangeOwnPasswordError } from "./application/change-own-password";
export type { CreateInviteError, RevokeInviteError } from "./application/manage-invites";
export type {
  ResetPasswordError,
  SetAdminError,
  SetDisabledError,
  SetSelfFundingError,
} from "./application/manage-players";
export {
  INVITE_DEFAULT_DAYS,
  INVITE_MAX_DAYS,
  INVITE_MIN_DAYS,
  type Invite,
  type InviteStatus,
} from "./domain/invite";
export {
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "./domain/credentials";
export type { Actor, Player } from "./domain/player";
export { hasAnyPlayers, listInvites, listPlayers } from "./queries/admin";
export type { InviteListItem, PlayerListItem } from "./queries/admin";
