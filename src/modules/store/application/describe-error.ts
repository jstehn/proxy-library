import { assertNever, Cents } from "@/shared/kernel";
import type { BuyListError } from "./buy-list";
import type { BuySealedError } from "./buy-sealed";
import type { BuySingleError, SellSingleError } from "./singles";

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

export function describeBuySingleError(error: BuySingleError): string {
  switch (error.kind) {
    case "NotForSale":
      return "This card's set isn't in the store.";
    case "NoPrice":
      return "There's no market price for this finish, so the store can't sell it.";
    case "QuantityInvalid":
      return `You can buy 1 to ${error.max} at a time.`;
    case "InsufficientFunds":
      return `Not enough money: you have ${Cents.format(error.balance)} and this costs ${Cents.format(error.required)}.`;
    default:
      return assertNever(error);
  }
}

export function describeSellSingleError(error: SellSingleError): string {
  switch (error.kind) {
    case "NoPrice":
      return "There's no market price for this finish, so the store can't buy it.";
    case "QuantityInvalid":
      return `You can sell 1 to ${error.max} at a time.`;
    case "NotEnoughCopies":
      return `You only have ${error.owned}.`;
    case "WorthNothing":
      return "This card has no market value, so the store can't pay for it.";
    case "NotBuying":
      return "The store isn't buying cards right now.";
    default:
      return assertNever(error);
  }
}

export function describeBuyListError(error: BuyListError): string {
  switch (error.kind) {
    case "ListEmpty":
      return "There's nothing to buy in this list.";
    case "ListTooLong":
      return `At most ${error.max} lines at once.`;
    case "QuantityInvalid":
      return `Each line can buy 1 to ${error.max} copies.`;
    case "LineNotForSale":
      return `Line ${error.line + 1} can't be bought any more. Nothing was bought.`;
    case "PricesChanged":
      return `Prices changed since you looked: it's now ${Cents.format(error.total)}. Nothing was bought; check the new total and buy again.`;
    case "InsufficientFunds":
      return `That's ${Cents.format(error.required)}, and you have ${Cents.format(error.balance)}. Nothing was bought.`;
  }
}
