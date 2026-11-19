import { describe, expect, it } from "vitest";
import { Cents } from "@/shared/kernel";
import { describeBuySealedError } from "./describe-error";

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
