import { describe, expect, it } from "vitest";
import { Cents } from "@/shared/kernel";
import {
  describeAddWishError,
  describeBuyWishError,
  describeUpdateWishError,
} from "./describe-error";

describe("describeAddWishError", () => {
  it("passes on the reason a wish was invalid", () => {
    expect(describeAddWishError({ kind: "InvalidWish", reason: "Quantity is 1 to 99." })).toBe(
      "Quantity is 1 to 99.",
    );
  });

  it("says what a printing comes in and how many wishes fit", () => {
    expect(describeAddWishError({ kind: "CardNotFound" })).toBe("That card isn't in the catalog.");
    expect(
      describeAddWishError({ kind: "FinishNotAvailable", finishes: ["nonfoil", "foil"] }),
    ).toBe("This printing only comes in nonfoil and foil.");
    expect(describeAddWishError({ kind: "WishlistFull", max: 200 })).toBe(
      "Your wishlist is full (200 wishes). Remove some first.",
    );
  });
});

describe("describeUpdateWishError", () => {
  it("says a wish that is gone is gone", () => {
    expect(describeUpdateWishError({ kind: "WishNotFound" })).toBe("That wish is gone.");
    expect(describeUpdateWishError({ kind: "InvalidWish", reason: "Too many." })).toBe("Too many.");
  });
});

describe("describeBuyWishError", () => {
  it("names the limits and the money", () => {
    expect(describeBuyWishError({ kind: "BuyQuantityInvalid", max: 3 })).toBe(
      "You can buy 1 to 3: the copies you're still missing.",
    );
    expect(describeBuyWishError({ kind: "QuantityInvalid", max: 20 })).toBe(
      "You can buy 1 to 20 at a time.",
    );
    expect(describeBuyWishError({ kind: "PricesChanged", total: Cents.of(1250) })).toContain(
      "$12.50",
    );
    expect(
      describeBuyWishError({
        kind: "InsufficientFunds",
        balance: Cents.of(500),
        required: Cents.of(1250),
      }),
    ).toBe("Not enough money: you have $5.00 and this costs $12.50.");
  });

  it("gives the plain failures one sentence each", () => {
    expect(describeBuyWishError({ kind: "WishNotFound" })).toBe("That wish is gone.");
    expect(describeBuyWishError({ kind: "AlreadyOwned" })).toBe(
      "You already own every copy you wanted.",
    );
    expect(describeBuyWishError({ kind: "DoesNotFit" })).toBe(
      "That printing isn't what this wish asks for.",
    );
    expect(describeBuyWishError({ kind: "NotForSale" })).toBe(
      "This card's set isn't in the store any more.",
    );
    expect(describeBuyWishError({ kind: "NoPrice" })).toBe(
      "There's no market price for this finish now, so the store can't sell it.",
    );
  });
});
