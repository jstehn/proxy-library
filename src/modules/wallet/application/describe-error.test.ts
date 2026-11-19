import { describe, expect, it } from "vitest";
import { Cents } from "@/shared/kernel";
import { describeAddOwnFundsError, describeCorrectBalanceError } from "./describe-error";

describe("wallet error sentences", () => {
  it("names the most a player can add at once, in dollars", () => {
    expect(describeAddOwnFundsError({ kind: "SelfFundLimitExceeded", limit: Cents.of(5000) })).toBe(
      "You can add at most $50.00 at a time.",
    );
  });

  it("says a balance can't go below zero", () => {
    expect(
      describeCorrectBalanceError({ kind: "InsufficientFunds", balance: Cents.of(120) } as never),
    ).toBe("They only have $1.20, and a balance can't go below $0.00.");
  });
});
