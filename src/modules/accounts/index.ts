// The accounts module's public API: the only file other modules and the app may import.
export { makeAccounts } from "./application/make-accounts";
export type { Accounts } from "./application/make-accounts";
export { makeGetAccountOverview, type AccountOverview } from "./application/get-account-overview";
export type {
  CreateAccessTokenError,
  CreateAccessTokenInput,
  CreatedAccessToken,
  TokenActor,
} from "./application/access-tokens";
export type {
  ApproveError,
  AuthorizationParameters,
  AuthorizationProblem,
  AuthorizationRequest,
  IssuedToken,
  RegisterClientInput,
  TokenRequest,
} from "./application/oauth";
export { type OAuthClient } from "./domain/oauth";
export {
  AccessTokenId,
  allows,
  MAX_LIVE_TOKENS,
  SCOPES,
  type AccessToken,
  type Scope,
} from "./domain/access-token";
export type {
  AccessTokenRepository,
  AccountsDependencies,
  AccountsServices,
  IdentityProvider,
  InviteRepository,
  OAuthRepository,
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
export { PASSWORD_MIN_LENGTH } from "./domain/credentials";
export { pickForAdmin, type Actor, type AdminActor, type Player } from "./domain/player";
export * as accountQueries from "./queries";
export * as accountPublicQueries from "./queries/public";
export type { InviteListItem, PlayerListItem } from "./queries/admin";
export {
  describeChangeOwnPasswordError,
  describeSignInError,
  describeRegisterPlayerError,
  describePlayerActionError,
  type PlayerActionError,
} from "./application/describe-error";
