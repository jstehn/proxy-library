import { assertNever } from "@/shared/kernel";
import type { ChangeOwnPasswordError } from "./change-own-password";
import type { SetPlayerEmailError } from "./external-sign-in";
import type { SignInError } from "./sign-in";
import type { RegisterPlayerError } from "./register-player";
import type {
  ResetPasswordError,
  SetAdminError,
  SetDisabledError,
  SetSelfFundingError,
} from "./manage-players";

// What each expected failure says to the player, in one place per module (ADR 0026, audit S7).
// The `switch` is exhaustive: a new error kind doesn't compile until it has a sentence.

export type PlayerActionError =
  SetAdminError | SetSelfFundingError | SetDisabledError | ResetPasswordError;

export function describeChangeOwnPasswordError(error: ChangeOwnPasswordError): string {
  switch (error.kind) {
    case "PasswordInvalid":
      return `New password ${error.reason}.`;
    case "InvalidCredentials":
      return "Your current password isn't right.";
    case "PlayerNotFound":
      return "Your account could not be found. Try signing in again.";
    default:
      return assertNever(error);
  }
}

export function describeSignInError(error: SignInError): string {
  switch (error.kind) {
    case "InvalidCredentials":
      return "That username and password don't match.";
    case "AccountDisabled":
      return "This account has been disabled. Ask an admin if you think that's a mistake.";
    default:
      return assertNever(error);
  }
}

/**
 * What a failed sign-in with Authentik says. The code is Better Auth's `?error=`, which is
 * whatever the provider or the library sent: only the ones that mean something get their own words.
 */
export function describeExternalSignInError(code: string | undefined): string | null {
  if (code === undefined) return null;
  switch (code) {
    case "signup_disabled":
    case "account_not_linked":
      return (
        "No Proxy Library player is linked to this Authentik account. Sign in with your " +
        "password and link it from your Account page, or ask an admin."
      );
    case "disabled":
      return describeSignInError({ kind: "AccountDisabled" });
    case "unavailable":
      return "Signing in with Authentik isn't available right now. Use your password.";
    default:
      return "Signing in with Authentik didn't work. Try again, or use your password.";
  }
}

/** The same for linking from the Account page. */
export function describeExternalLinkError(code: string | undefined): string | null {
  if (code === undefined) return null;
  return code === "account_already_linked_to_different_user"
    ? "That Authentik account is already linked to another player."
    : "Linking your Authentik account didn't work. Try again.";
}

export function describeSetPlayerEmailError(error: SetPlayerEmailError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can change a player's email.";
    case "PlayerNotFound":
      return "That player could not be found.";
    case "EmailInvalid":
      return `Email ${error.reason}.`;
    case "EmailTaken":
      return "Another player already has that email.";
    default:
      return assertNever(error);
  }
}

export function describeRegisterPlayerError(error: RegisterPlayerError): string {
  switch (error.kind) {
    case "UsernameInvalid":
      return `Username ${error.reason}.`;
    case "DisplayNameInvalid":
      return `Display name ${error.reason}.`;
    case "PasswordInvalid":
      return `Password ${error.reason}.`;
    case "UsernameTaken":
      return "That username is taken. Try another.";
    case "InviteRequired":
      return "You need an invite code from an admin to register.";
    case "InviteNotFound":
      return "That invite code doesn't exist. Check it for typos.";
    case "InviteNotOpen":
      return `That invite code has been ${error.status === "revoked" ? "cancelled" : error.status}. Ask an admin for a new one.`;
    default:
      return assertNever(error);
  }
}

export function describePlayerActionError(error: PlayerActionError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can do that.";
    case "PlayerNotFound":
      return "That player no longer exists.";
    case "LastAdmin":
      return "There must always be at least one active admin. Promote someone else first.";
    case "CannotDisableSelf":
      return "You can't disable your own account. Ask another admin.";
    default:
      return assertNever(error);
  }
}
