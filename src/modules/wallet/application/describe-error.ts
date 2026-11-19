import { assertNever, Cents } from "@/shared/kernel";
import type { AddOwnFundsError, CorrectBalanceError } from "./manage-money";
import type { UpdateEconomySettingsError } from "./update-economy-settings";

// What each expected failure says to the player, in one place per module (ADR 0026, audit S7).
// The `switch` is exhaustive: a new error kind doesn't compile until it has a sentence.

export function describeAddOwnFundsError(error: AddOwnFundsError): string {
  switch (error.kind) {
    case "SelfFundingNotAllowed":
      return "You don't have permission to add your own funds. Ask an admin.";
    case "AmountInvalid":
      return `Amount ${error.reason}.`;
    case "NoteInvalid":
      return `Note ${error.reason}.`;
    case "SelfFundLimitExceeded":
      return `You can add at most ${Cents.format(error.limit)} at a time.`;
    default:
      return assertNever(error);
  }
}

export function describeCorrectBalanceError(error: CorrectBalanceError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can do that.";
    case "AmountInvalid":
      return `Amount ${error.reason}.`;
    case "NoteInvalid":
      return `Note ${error.reason}.`;
    case "PlayerNotFound":
      return "That player no longer exists.";
    case "InsufficientFunds":
      return `They only have ${Cents.format(error.balance)}, and a balance can't go below $0.00.`;
    default:
      return assertNever(error);
  }
}

export function describeUpdateEconomySettingsError(error: UpdateEconomySettingsError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can change the economy.";
    case "SettingsInvalid":
      return error.reason;
    default:
      return assertNever(error);
  }
}
