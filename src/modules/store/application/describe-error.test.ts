import { describe, expect, it } from "vitest";
import { PrintingId } from "@/modules/catalog";
import { Cents } from "@/shared/kernel";
import {
  describeBuyListError,
  describeBuySealedError,
  describeBuySingleError,
  describeSellSingleError,
} from "./describe-error";

describe("store error sentences", () => {
  it("says what the player has and what the purchase costs", () => {
    expect(
      describeBuySealedError({
        kind: "InsufficientFunds",
        balance: Cents.of(100),
        required: Cents.of(450),
      } as never),
    ).toBe("Not enough money: you have $1.00 and this costs $4.50.");
  });
});

describe("single card and list sentences", () => {
  it("names the limits a purchase or sale hit", () => {
    expect(describeBuySingleError({ kind: "QuantityInvalid", max: 99 })).toBe(
      "You can buy 1 to 99 at a time.",
    );
    expect(describeSellSingleError({ kind: "QuantityInvalid", max: 99 })).toBe(
      "You can sell 1 to 99 at a time.",
    );
    expect(
      describeSellSingleError({
        kind: "NotEnoughCopies",
        printingId: PrintingId.of("abc"),
        finish: "foil",
        owned: 2,
        needed: 3,
      }),
    ).toBe("You only have 2.");
    expect(describeBuyListError({ kind: "ListTooLong", max: 100 })).toBe(
      "At most 100 lines at once.",
    );
  });

  it("says nothing was bought when a list fails", () => {
    expect(describeBuyListError({ kind: "LineNotForSale", line: 0 })).toBe(
      "Line 1 can't be bought any more. Nothing was bought.",
    );
    expect(describeBuyListError({ kind: "PricesChanged", total: Cents.of(1250) })).toContain(
      "now $12.50. Nothing was bought",
    );
  });

  it("gives the plain failures one sentence each", () => {
    expect(describeBuySingleError({ kind: "NotForSale" })).toBe(
      "This card's set isn't in the store.",
    );
    expect(describeSellSingleError({ kind: "NotBuying" })).toBe(
      "The store isn't buying cards right now.",
    );
  });
});
