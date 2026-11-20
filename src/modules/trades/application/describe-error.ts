import { Cents, assertNever } from "@/shared/kernel";
import type { Shortfall } from "../domain/errors";
import type { AcceptTradeError, CounterTradeError } from "./trades";

// What every expected failure of the trades module says to the player, in one place (ADR 0026).
// The `switch` is exhaustive: a new error kind doesn't compile until it has a sentence.

function describeShortfall(shortfall: Shortfall): string {
  const who = shortfall.side === "proposer" ? "The proposer" : "The recipient";
  if (shortfall.what === "cards") {
    return `${who} has ${shortfall.owned} of a card the trade needs ${shortfall.needed} of.`;
  }
  return `${who} has ${Cents.format(shortfall.balance)}, and the trade needs ${Cents.format(shortfall.needed)}.`;
}

export function describeProposeTradeError(error: CounterTradeError): string {
  switch (error.kind) {
    case "CannotTradeWithYourself":
      return "You can't trade with yourself.";
    case "PlayerNotFound":
      return "That player can't trade right now.";
    case "OfferInvalid":
      return `The offer isn't valid: ${error.reason}.`;
    case "OfferNotPossible":
      return describeShortfall(error.shortfall);
    case "TradeNotFound":
      return "That trade isn't waiting for you.";
    case "AlreadyDecided":
      return `That trade was already ${error.status}.`;
    default:
      return assertNever(error);
  }
}

export function describeDecideTradeError(error: AcceptTradeError): string {
  switch (error.kind) {
    case "TradeNotFound":
      return "That trade isn't yours to decide.";
    case "AlreadyDecided":
      return `That trade was already ${error.status}.`;
    case "NoLongerPossible":
      return `This trade can't happen any more. ${describeShortfall(error.shortfall)} Nothing was moved; decline it or counter.`;
    default:
      return assertNever(error);
  }
}
