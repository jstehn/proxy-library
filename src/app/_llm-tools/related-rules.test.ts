import { describe, expect, it } from "vitest";
import { findRuleInteractions, findSharedRules, matchRelatedRules } from "./related-rules";

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

  it("distinguishes mana-ability altars (CR 605.1a, beat split second) from non-mana sacrifice outlets (CR 602.2)", () => {
    const mortuary = matchRelatedRules(
      "Whenever a creature is put into your graveyard from the battlefield, put that card on top of your library.",
    );
    expect(mortuary.map((r) => r.rule)).toContain("CR 400.7");

    const krosanGrip = matchRelatedRules("Split second (As long as this spell is on the stack...)");
    expect(krosanGrip.map((r) => r.rule)).toContain("CR 702.61a");

    const ashnods = matchRelatedRules("Sacrifice a creature: Add {C}{C}.");
    expect(ashnods.map((r) => r.rule)).toContain("CR 605.1a");
    expect(ashnods.map((r) => r.rule)).not.toContain("CR 602.2");

    const phyrexian = matchRelatedRules("Sacrifice a creature: Add one mana of any color.");
    expect(phyrexian.map((r) => r.rule)).toContain("CR 605.1a");
    expect(phyrexian.map((r) => r.rule)).not.toContain("CR 602.2");

    const visceraSeer = matchRelatedRules("Sacrifice a creature: Scry 1.");
    expect(visceraSeer.map((r) => r.rule)).toContain("CR 602.2");
    expect(visceraSeer.map((r) => r.rule)).not.toContain("CR 605.1a");
  });

  it("surfaces cross-rule interactions via interactsWith edges (split second vs mana/non-mana abilities)", () => {
    const interactions = findRuleInteractions([
      {
        name: "Krosan Grip",
        relatedRules: matchRelatedRules("Split second (As long as this spell is on the stack...)"),
      },
      {
        name: "Ashnod's Altar",
        relatedRules: matchRelatedRules("Sacrifice a creature: Add {C}{C}."),
      },
      {
        name: "Viscera Seer",
        relatedRules: matchRelatedRules("Sacrifice a creature: Scry 1."),
      },
    ]);

    expect(interactions).toContainEqual(
      expect.objectContaining({
        fromRule: "CR 605.1a",
        toRule: "CR 702.61a",
        relationship: "overrides",
        fromCards: ["Ashnod's Altar"],
        toCards: ["Krosan Grip"],
      }),
    );
    expect(interactions).toContainEqual(
      expect.objectContaining({
        fromRule: "CR 602.2",
        toRule: "CR 702.61a",
        relationship: "blocked_by",
        fromCards: ["Viscera Seer"],
        toCards: ["Krosan Grip"],
      }),
    );
  });

  it("surfaces multi-mechanic interactions across zone-cast permissions, alt costs, and replacement effects", () => {
    const interactions = findRuleInteractions([
      {
        name: "Bolas's Citadel",
        relatedRules: matchRelatedRules("You may cast spells from the top of your library."),
      },
      {
        name: "Henzie",
        relatedRules: matchRelatedRules(
          "Each creature spell you cast from your hand with mana value 4 or greater has blitz.",
        ),
      },
      {
        name: "Rest in Peace",
        relatedRules: matchRelatedRules(
          "If a card or token would be put into a graveyard from anywhere, exile it instead.",
        ),
      },
      {
        name: "Blood Artist",
        relatedRules: matchRelatedRules("Whenever Blood Artist or another creature dies, ..."),
      },
    ]);

    expect(
      interactions.some(
        (i) =>
          i.fromRule === "CR 118.9" && i.toRule === "CR 601.2" && i.relationship === "blocked_by",
      ),
    ).toBe(true);
    expect(
      interactions.some(
        (i) => i.fromRule === "CR 614" && i.toRule === "CR 400.7" && i.relationship === "overrides",
      ),
    ).toBe(true);
  });
});
