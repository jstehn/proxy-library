import { assertNever, Cents } from "@/shared/kernel";
import type { BuySealedError } from "./buy-sealed";

// What each expected failure says to the player, in one place per module (ADR 0026, audit S7).
// The `switch` is exhaustive: a new error kind doesn't compile until it has a sentence.

export function describeBuySealedError(error: BuySealedError): string {
  switch (error.kind) {
    case "ProductNotForSale":
      return "That product isn't for sale.";
    case "QuantityInvalid":
      return `You can buy 1 to ${error.max} at a time.`;
    case "InsufficientFunds":
      return `Not enough money: you have ${Cents.format(error.balance)} and this costs ${Cents.format(error.required)}.`;
    default:
      return assertNever(error);
  }
}
