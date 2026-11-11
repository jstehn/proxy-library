import { describe, expect, it } from "vitest";
import { cutReasonText } from "./labels";

// Cut reasons in words (design doc 32): what the builder's panel and rank_cuts say.

describe("cutReasonText", () => {
  it("says why a card is weak or worth keeping", () => {
    expect(cutReasonText({ kind: "noFit" })).toBe("Fits none of the deck's themes");
    expect(cutReasonText({ kind: "fits", reasons: [{ kind: "theme", theme: "tokens" }] })).toMatch(
      /^Fits: /,
    );
    expect(cutReasonText({ kind: "surplusRole", tag: "ramp", count: 14, target: 10 })).toBe(
      "Ramp: 14 in the deck, target 10",
    );
    expect(cutReasonText({ kind: "neededRole", tag: "wipe", count: 2, target: 3 })).toBe(
      "Board wipes: only 2 of 3, keep it",
    );
    expect(cutReasonText({ kind: "topHeavy", manaValue: 7, average: 3.6 })).toBe(
      "7 mana, and the curve averages 3.6",
    );
    expect(cutReasonText({ kind: "overBracket", target: 2, flags: ["gameChanger"] })).toBe(
      "a Game Changer: over your bracket 2 target",
    );
    expect(cutReasonText({ kind: "notOwned", short: 1 })).toBe("You're short 1");
  });
});
