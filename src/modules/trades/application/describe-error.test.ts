import { describe, expect, it } from "vitest";
import { PrintingId } from "@/modules/catalog";
import { Cents } from "@/shared/kernel";
import { describeDecideTradeError, describeProposeTradeError } from "./describe-error";

const card = { printingId: PrintingId.of("abc"), finish: "nonfoil" } as const;

describe("describeProposeTradeError", () => {
  it("says who is short of what", () => {
    expect(
      describeProposeTradeError({
        kind: "OfferNotPossible",
        shortfall: { what: "cards", side: "proposer", ...card, owned: 1, needed: 3 },
      }),
    ).toBe("The proposer has 1 of a card the trade needs 3 of.");
    expect(
      describeProposeTradeError({
        kind: "OfferNotPossible",
        shortfall: {
          what: "money",
          side: "recipient",
          balance: Cents.of(100),
          needed: Cents.of(250),
        },
      }),
    ).toBe("The recipient has $1.00, and the trade needs $2.50.");
  });

  it("gives the plain failures one sentence each", () => {
    expect(describeProposeTradeError({ kind: "CannotTradeWithYourself" })).toBe(
      "You can't trade with yourself.",
    );
    expect(describeProposeTradeError({ kind: "PlayerNotFound" })).toBe(
      "That player can't trade right now.",
    );
    expect(describeProposeTradeError({ kind: "OfferInvalid", reason: "empty" })).toBe(
      "The offer isn't valid: empty.",
    );
    expect(describeProposeTradeError({ kind: "TradeNotFound" })).toBe(
      "That trade isn't waiting for you.",
    );
    expect(describeProposeTradeError({ kind: "AlreadyDecided", status: "accepted" })).toBe(
      "That trade was already accepted.",
    );
  });
});

describe("describeDecideTradeError", () => {
  it("explains a trade that can't happen any more", () => {
    expect(
      describeDecideTradeError({
        kind: "NoLongerPossible",
        shortfall: { what: "cards", side: "recipient", ...card, owned: 0, needed: 1 },
      }),
    ).toBe(
      "This trade can't happen any more. The recipient has 0 of a card the trade needs 1 of. Nothing was moved; decline it or counter.",
    );
  });

  it("gives the other failures one sentence each", () => {
    expect(describeDecideTradeError({ kind: "TradeNotFound" })).toBe(
      "That trade isn't yours to decide.",
    );
    expect(describeDecideTradeError({ kind: "AlreadyDecided", status: "declined" })).toBe(
      "That trade was already declined.",
    );
  });
});
