import { describe, expect, it } from "vitest";
import { findSharedRules, matchRelatedRules } from "./related-rules";

describe("related-rules", () => {
  it("matches CR 513, CR 118.9, and CR 400.7 patterns", () => {
    const avacynRules = matchRelatedRules(
      "At the beginning of the next end step, return that card to the battlefield.",
    );
    expect(avacynRules.some((r) => r.rule === "CR 513")).toBe(true);

    const blitzRules = matchRelatedRules(
      "Blitz {2}{B}{R}. Sacrifice it at the beginning of the next end step. When it dies, draw a card.",
    );
    expect(blitzRules.map((r) => r.rule)).toContain("CR 118.9");
    expect(blitzRules.map((r) => r.rule)).toContain("CR 513");
  });

  it("finds shared rules across interacting cards", () => {
    const shared = findSharedRules([
      {
        name: "Bolas's Citadel",
        relatedRules: matchRelatedRules("You may cast spells from the top of your library."),
      },
      {
        name: "Henzie",
        relatedRules: matchRelatedRules(
          "Each creature spell you cast from your hand with mana value 4 or greater has blitz. Alternative cost.",
        ),
      },
      {
        name: "Avacyn",
        relatedRules: matchRelatedRules("At the beginning of the next end step, sacrifice it."),
      },
      {
        name: "Blitz Creature",
        relatedRules: matchRelatedRules("Sacrifice it at the beginning of the next end step."),
      },
    ]);
    expect(shared.some((s) => s.rule === "CR 513" && s.cards.length === 2)).toBe(true);
  });

  it("matches Mortuary graveyard-from-battlefield triggers and split second vs sacrifice outlets", () => {
    const mortuary = matchRelatedRules(
      "Whenever a creature is put into your graveyard from the battlefield, put that card on top of your library.",
    );
    expect(mortuary.map((r) => r.rule)).toContain("CR 400.7");

    const krosanGrip = matchRelatedRules("Split second (As long as this spell is on the stack...)");
    expect(krosanGrip.map((r) => r.rule)).toContain("CR 702.61a");

    const altar = matchRelatedRules("Sacrifice a creature: Put a +1/+1 counter on target creature.");
    expect(altar.map((r) => r.rule)).toContain("CR 605.1a");
  });
});
