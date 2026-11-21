import { Cents, assertNever } from "@/shared/kernel";
import type { BuyWishError } from "./buy-wish";
import type { AddWishError, UpdateWishError } from "./manage-wishes";

// What every expected failure of the wishlist module says to the player, in one place (ADR 0026).
// The `switch` is exhaustive: a new error kind doesn't compile until it has a sentence.

export function describeAddWishError(error: AddWishError): string {
  switch (error.kind) {
    case "InvalidWish":
      return error.reason;
    case "CardNotFound":
      return "That card isn't in the catalog.";
    case "FinishNotAvailable":
      return `This printing only comes in ${error.finishes.join(" and ")}.`;
    case "WishlistFull":
      return `Your wishlist is full (${error.max} wishes). Remove some first.`;
    default:
      return assertNever(error);
  }
}

export function describeUpdateWishError(error: UpdateWishError): string {
  switch (error.kind) {
    case "InvalidWish":
      return error.reason;
    case "WishNotFound":
      return "That wish is gone.";
    default:
      return assertNever(error);
  }
}

export function describeBuyWishError(error: BuyWishError): string {
  switch (error.kind) {
    case "WishNotFound":
      return "That wish is gone.";
    case "AlreadyOwned":
      return "You already own every copy you wanted.";
    case "DoesNotFit":
      return "That printing isn't what this wish asks for.";
    case "BuyQuantityInvalid":
      return `You can buy 1 to ${error.max}: the copies you're still missing.`;
    case "QuantityInvalid":
      return `You can buy 1 to ${error.max} at a time.`;
    case "PricesChanged":
      return `The price went up since the page loaded: it's ${Cents.format(error.total)} now. Check it and buy again.`;
    case "NotForSale":
      return "This card's set isn't in the store any more.";
    case "NoPrice":
      return "There's no market price for this finish now, so the store can't sell it.";
    case "InsufficientFunds":
      return `Not enough money: you have ${Cents.format(error.balance)} and this costs ${Cents.format(error.required)}.`;
    default:
      return assertNever(error);
  }
}
