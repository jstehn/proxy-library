import { describe, expect, it } from "vitest";
import {
  EMPTY_DECK_PROFILE,
  effectiveManaValue,
  isAvoidCard,
  isKeyCard,
  patchPrimerSection,
  resolveDeckProfileTargets,
  summarizeDeckProfile,
  type DeckProfile,
} from "./deck-profile";

describe("deck-profile domain", () => {
  it("resolves targets using profile -> edhrec -> generic fallback chain", () => {
    const profile: DeckProfile = {
      ...EMPTY_DECK_PROFILE,
      landTarget: 35,
      roleTargets: { ramp: 15 },
    };
    const resolved = resolveDeckProfileTargets(profile, {
      landTarget: 34,
      roleTargets: { ramp: 11, draw: 12 },
    });
    expect(resolved.landTarget).toBe(35);
    expect(resolved.roleTargets).toEqual({
      ramp: 15,
      draw: 12,
      removal: 8,
      wipe: 3,
    });
  });

  it("applies cost reducers including per-command-cast scaling", () => {
    const profile: DeckProfile = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [
        {
          cardName: "Henzie \"Toolbox\" Torre",
          scope: "blitz",
          genericReduction: 1,
          perCommandCast: true,
        },
        {
          cardName: "Goreclaw, Terror of Qal Sisma",
          scope: "creature_power_gte_4",
          genericReduction: 2,
        },
      ],
    };
    // 6-mana creature with power 6 cast via blitz with Henzie cast twice: -2 from Henzie, -2 from Goreclaw -> 2
    const mv = effectiveManaValue(
      6,
      { typeLine: "Creature — Demon", power: "6", isBlitz: true },
      profile,
      2,
    );
    expect(mv).toBe(2);
  });

  it("checks keyCards, pinned entries, and avoid cards case-insensitively", () => {
    const profile: DeckProfile = {
      ...EMPTY_DECK_PROFILE,
      keyCards: [{ cardName: "Avacyn, Angel of Hope", reason: "Centerpiece" }],
      avoid: [{ cardName: "Mortuary", reason: "Breaks reanimation" }],
    };
    expect(isKeyCard("avacyn, angel of hope", profile)).toBe(true);
    expect(isKeyCard("Sol Ring", profile, true)).toBe(true);
    expect(isAvoidCard("mortuary", profile)).toBe(true);
    expect(isAvoidCard("Sol Ring", profile)).toBe(false);
  });

  it("patches a single primer section without overwriting others", () => {
    const initial = [
      "## Plan",
      "",
      "Old plan.",
      "",
      "## Mulligan",
      "",
      "Keep 2 lands + ramp.",
    ].join("\n");

    const updated = patchPrimerSection(initial, "Plan", "Blitz value and sacrifice.");
    expect(updated).toContain("## Plan\n\nBlitz value and sacrifice.");
    expect(updated).toContain("## Mulligan\n\nKeep 2 lands + ramp.");
    expect(updated).not.toContain("Old plan.");

    const appended = patchPrimerSection(updated, "Watch out for", "Rest in Peace.");
    expect(appended).toContain("## Watch out for\n\nRest in Peace.");
    expect(appended).toContain("## Mulligan\n\nKeep 2 lands + ramp.");
  });

  it("summarizes deck profile concisely", () => {
    const summary = summarizeDeckProfile({
      ...EMPTY_DECK_PROFILE,
      plan: "Blitz value with sacrifice and recursion.",
      winCons: ["Avacyn + free outlet + Zulaport drain"],
      keyCards: [{ cardName: "Avacyn, Angel of Hope", reason: "Board lock" }],
    });
    expect(summary).toContain("Blitz value");
    expect(summary).toContain("Avacyn, Angel of Hope");
  });
});
