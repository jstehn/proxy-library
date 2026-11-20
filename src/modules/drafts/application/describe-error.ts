import { Cents, assertNever } from "@/shared/kernel";
import type {
  AddBotError,
  AnswerError,
  CreateDraftError,
  EndDealsError,
  JoinDraftError,
  LeaveDraftError,
  MakeDraftDeckError,
  PickError,
  PickForAwayError,
  RemoveBotError,
  StartDraftError,
} from "./drafts";

// What every expected failure of the drafts module says to the player, in one place (ADR 0026).
// The `switch` is exhaustive: a new error kind doesn't compile until it has a sentence.

export type DraftError =
  | CreateDraftError
  | JoinDraftError
  | LeaveDraftError
  | StartDraftError
  | PickError
  | PickForAwayError
  | AnswerError
  | EndDealsError
  | MakeDraftDeckError
  | AddBotError
  | RemoveBotError;

export function describeDraftError(error: DraftError): string {
  switch (error.kind) {
    case "DraftNotFound":
      return "That draft doesn't exist.";
    case "DraftNotOpen":
      return "That draft has already started or closed.";
    case "DraftNotRunning":
      return "That draft isn't running.";
    case "DraftNotFinished":
      return "The draft isn't finished yet.";
    case "DraftFull":
      return `That draft is full (${error.maxSeats} players).`;
    case "AlreadyInADraft":
      return "You're already in a draft. Finish or leave it first.";
    case "NotSeated":
      return "You're not playing in that draft.";
    case "NotHost":
      return "Only the host can do that.";
    case "TooFewPlayers":
      return `A draft needs at least ${error.minimum} players.`;
    case "StalePick":
      return "That pick is out of date: here's your pack now.";
    case "NotAway":
      return "That player is still here. Give them a moment.";
    case "NothingToPick":
      return "That player has no pack waiting.";
    case "SeatsInvalid":
      return `A draft seats ${error.minimum} to ${error.maximum} players.`;
    case "TimerInvalid":
      return `The pick timer must be ${error.minimum} to ${error.maximum} seconds, or off.`;
    case "BoosterNotDraftable":
      return "That booster can't be drafted.";
    case "PriceUnavailable":
      return "The store has no price for that booster, so there's no entry fee to charge.";
    case "InsufficientFunds":
      return `You have ${Cents.format(error.balance)}; the entry fee is ${Cents.format(error.required)}.`;
    case "BotsForAdminsOnly":
      return "Only an admin hosting the lobby can add bots.";
    case "BotNotFound":
      return "That bot has already left.";
    case "AwaitingChoices":
      return "First make your choices about the card you drew.";
    case "ChooseColorsFirst":
      return "First choose the color you owe.";
    case "MustDraftAtRandom":
      return "Your Archdemon of Paliano is face up: you draft at random.";
    case "AbilityUnavailable":
      return `You can't do that now: ${error.reason}.`;
    case "NothingToAnswer":
      return "There's nothing waiting for your answer.";
    case "CardNoLongerOwned":
      return "That card isn't in your collection any more, so it can't change hands.";
    case "LorePackUnavailable":
      return `That pack can't be added: ${error.reason}.`;
    case "TooManyDecks":
      return `You have ${error.maximum} decks, the most allowed. Delete one first.`;
    default:
      return assertNever(error);
  }
}
