import { assertNever } from "@/shared/kernel";
import type { ChangeOwnPasswordError } from "./change-own-password";
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
