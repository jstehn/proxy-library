import { describe, expect, it } from "vitest";
import {
  commanderOnlyProfile,
  EMPTY_DECK_PROFILE,
  effectiveManaValue,
  declaredComboFor,
  isAvoidCard,
  isKeyCard,
  patchPrimerSection,
  resolveDeckProfileTargets,
  summarizeDeckProfile,
  type DeckPlan,
} from "./deck-profile";

describe("deck-profile domain", () => {
  it("resolves targets using profile -> edhrec -> generic fallback chain", () => {
    const profile: DeckPlan = {
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
    const profile: DeckPlan = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [
        {
          cardName: 'Henzie "Toolbox" Torre',
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
    const profile: DeckPlan = {
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

    // Empty content removes a section, and removing one that isn't there changes nothing.
    const removed = patchPrimerSection(appended, "Mulligan", "  ");
    expect(removed).not.toContain("Keep 2 lands");
    expect(patchPrimerSection(removed, "Nope", "")).toBe(removed);
    expect(patchPrimerSection(null, "Plan", "")).toBe("");
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

  it("supports general declarative costReducers across different commanders", () => {
    const henzie: DeckPlan = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [
        {
          cardName: 'Henzie "Toolbox" Torre',
          scope: "creatures",
          minManaValue: 4,
          genericReduction: 1,
          perCommandCast: true,
        },
      ],
    };
    expect(effectiveManaValue(6, { typeLine: "Creature — Wurm", power: "6" }, henzie, 1)).toBe(5);
    expect(effectiveManaValue(6, { typeLine: "Creature — Wurm", power: "6" }, henzie, 2)).toBe(4);
    expect(effectiveManaValue(3, { typeLine: "Creature — Elf", power: "2" }, henzie, 2)).toBe(3);
    expect(effectiveManaValue(5, { typeLine: "Sorcery" }, henzie, 2)).toBe(5);

    const goreclaw: DeckPlan = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [
        {
          cardName: "Goreclaw, Terror of Qal Sisma",
          scope: "creatures",
          minPower: 4,
          genericReduction: 2,
        },
      ],
    };
    expect(effectiveManaValue(6, { typeLine: "Creature — Beast", power: "5" }, goreclaw)).toBe(4);
    expect(effectiveManaValue(4, { typeLine: "Creature — Bear", power: "2" }, goreclaw)).toBe(4);

    const spellslinger: DeckPlan = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [
        { cardName: "Goblin Electromancer", scope: "instants_sorceries", genericReduction: 1 },
      ],
    };
    expect(effectiveManaValue(4, { typeLine: "Instant" }, spellslinger)).toBe(3);
    expect(effectiveManaValue(4, { typeLine: "Sorcery" }, spellslinger)).toBe(3);
    expect(effectiveManaValue(4, { typeLine: "Artifact" }, spellslinger)).toBe(4);

    const artifactDeck: DeckPlan = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [{ cardName: "Etherium Sculptor", scope: "artifacts", genericReduction: 1 }],
    };
    expect(effectiveManaValue(4, { typeLine: "Artifact Creature — Construct" }, artifactDeck)).toBe(
      3,
    );
    expect(effectiveManaValue(4, { typeLine: "Instant" }, artifactDeck)).toBe(4);

    // Commander self-reduction (e.g. Ghalta {10}{G}{G}) reduces generic cost but respects {G}{G} floor
    const ghalta: DeckPlan = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [
        { cardName: "Ghalta, Primal Hunger", scope: "commander", genericReduction: 8 },
      ],
    };
    expect(
      effectiveManaValue(
        12,
        {
          typeLine: "Legendary Creature — Elder Dinosaur",
          manaCost: "{10}{G}{G}",
          isCommander: true,
        },
        ghalta,
      ),
    ).toBe(4);
    const ghaltaMax: DeckPlan = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [
        { cardName: "Ghalta, Primal Hunger", scope: "commander", genericReduction: 15 },
      ],
    };
    expect(
      effectiveManaValue(
        12,
        {
          typeLine: "Legendary Creature — Elder Dinosaur",
          manaCost: "{10}{G}{G}",
          isCommander: true,
        },
        ghaltaMax,
      ),
    ).toBe(2);
    expect(
      effectiveManaValue(
        6,
        { typeLine: "Creature — Dinosaur", manaCost: "{4}{G}{G}", isCommander: false },
        ghalta,
      ),
    ).toBe(6);
  });
});

describe("declaredComboFor", () => {
  const combo = { id: "1234-5678", uses: ["Avacyn, Angel of Horror", "Viscera Seer"] };

  it("matches a declaration naming every piece, or the Spellbook id", () => {
    expect(declaredComboFor(combo, ["avacyn, angel of horror + viscera seer: loop", "Other"])).toBe(
      "avacyn, angel of horror + viscera seer: loop",
    );
    expect(declaredComboFor(combo, ["Spellbook 1234-5678"])).toBe("Spellbook 1234-5678");
  });

  it("doesn't match a declaration missing a piece", () => {
    expect(declaredComboFor(combo, ["Avacyn, Angel of Horror + Zulaport"])).toBeNull();
  });
});

describe("patchPrimerSection newline preservation", () => {
  it("preserves a blank line before the following ## heading", () => {
    const initial = "## Mulligan\n\nKeep 2 lands.\n\n## How It Wins\n\nSwing wide.";
    const updated = patchPrimerSection(
      initial,
      "Mulligan",
      "Keep 3 lands and trigger him on Turn 3.",
    );
    expect(updated).toBe(
      "## Mulligan\n\nKeep 3 lands and trigger him on Turn 3.\n\n## How It Wins\n\nSwing wide.",
    );
  });
});

describe("commanderOnlyProfile", () => {
  it("keeps commander-sourced costReducers and drops 99-card reducers like Emerald Medallion", () => {
    const profile: DeckPlan = {
      ...EMPTY_DECK_PROFILE,
      costReducers: [
        { cardName: "Emerald Medallion", scope: "all_spells", genericReduction: 1 },
        { cardName: "Henzie", scope: "blitz", genericReduction: 1 },
        { cardName: "Shroofus Sproutsire", scope: "commander", genericReduction: 1 },
      ],
    };
    const filtered = commanderOnlyProfile(profile, ['Henzie "Toolbox" Torre']);
    expect(filtered?.costReducers).toEqual([
      { cardName: "Henzie", scope: "blitz", genericReduction: 1 },
    ]);
    const shroofusFiltered = commanderOnlyProfile(profile, ["Shroofus Sproutsire"]);
    expect(shroofusFiltered?.costReducers).toEqual([
      { cardName: "Shroofus Sproutsire", scope: "commander", genericReduction: 1 },
    ]);
  });
});
