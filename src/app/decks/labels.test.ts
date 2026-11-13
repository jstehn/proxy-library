import { describe, expect, it } from "vitest";
import { cutReasonText, findingText, findingWithCards, reasonText, uncheckedText } from "./labels";

// Cut reasons in words (design doc 32): what the builder's panel and rank_cuts say. They're hints
// from simple checks, so they describe what was found rather than tell the player what to do.

describe("cutReasonText", () => {
  it("says why a card is weak or worth keeping", () => {
    expect(cutReasonText({ kind: "noFit" })).toBe("Matches none of the themes the app found");
    expect(cutReasonText({ kind: "fits", reasons: [{ kind: "theme", theme: "tokens" }] })).toMatch(
      /^Fits: /,
    );
    expect(cutReasonText({ kind: "surplusRole", tag: "ramp", count: 14, target: 10 })).toBe(
      "Ramp: 14 in the deck, target 10",
    );
    expect(cutReasonText({ kind: "neededRole", tag: "wipe", count: 2, target: 3 })).toBe(
      "Board wipes: 2 in the deck, target 3 (short)",
    );
    expect(cutReasonText({ kind: "topHeavy", manaValue: 7, average: 3.6 })).toBe(
      "7 mana, and the curve averages 3.6",
    );
    expect(cutReasonText({ kind: "overBracket", target: 2, flags: ["gameChanger"] })).toBe(
      "a Game Changer: over your bracket 2 target",
    );
    expect(cutReasonText({ kind: "notOwned", short: 1 })).toBe("You're short 1");
    expect(cutReasonText({ kind: "edhrec", inclusionPct: 45, synergyPct: 18 })).toBe(
      "EDHREC: 45% of decks (+18% synergy)",
    );
  });
});

describe("twoCardCombos labels", () => {
  it("formats early-game and late-game two-card combo findings and unchecked text", () => {
    expect(
      findingText({
        rule: "twoCardCombos",
        cards: ["Thassa's Oracle", "Demonic Consultation"],
        count: 1,
        forces: 4,
      }),
    ).toBe("Two-card combo (early-game: bracket 4)");
    expect(
      findingWithCards({
        rule: "twoCardCombos",
        cards: ["Kiki-Jiki", "Zealous Conscripts"],
        count: 1,
        forces: 3,
      }),
    ).toBe("Two-card combo (late-game only: bracket 3): Kiki-Jiki + Zealous Conscripts");
    expect(uncheckedText(["intent"])).toBe("Not checked: how you play the deck.");
    expect(uncheckedText(["intent", "combos"])).toBe(
      "Not checked: two-card combos, and how you play the deck.",
    );
    expect(reasonText({ kind: "combo", partners: ["Kiki-Jiki, Mirror Breaker"] })).toBe(
      "Combos with Kiki-Jiki, Mirror Breaker",
    );
  });
});
