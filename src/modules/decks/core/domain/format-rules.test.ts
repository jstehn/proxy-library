import { describe, expect, it } from "vitest";
import { FORMATS } from "./deck";
import { FORMAT_RULES, formatRules } from "./format-rules";

// What each format answered before the rules moved into one table (refactor P10, step A2): every
// answer below was recorded from the scattered checks it replaced.

const SIXTY_CARD_TARGETS = { ramp: 4, draw: 6, removal: 6, wipe: 2 };
const CONSTRUCTED = ["standard", "pioneer", "modern", "legacy", "vintage", "pauper"] as const;

describe("formatRules", () => {
  it("fills in every format", () => {
    expect(Object.keys(FORMAT_RULES).sort()).toEqual([...FORMATS].sort());
  });

  it("sizes decks: 100 exactly in Commander, 40 in Limited, 60 elsewhere", () => {
    expect(formatRules("commander").deckSize).toEqual({ cards: 100, exact: true });
    expect(formatRules("limited").deckSize).toEqual({ cards: 40, exact: false });
    for (const format of [...CONSTRUCTED, "casual"] as const) {
      expect(formatRules(format).deckSize).toEqual({ cards: 60, exact: false });
    }
    expect(
      ["commander", "limited", "casual"].map((format) => formatRules(format).suggestedLands),
    ).toEqual([37, 17, 24]);
  });

  it("limits copies and sideboards", () => {
    expect(FORMATS.map((format) => formatRules(format).copyLimit)).toEqual([
      null, // casual
      4,
      4,
      4,
      4,
      4,
      4,
      1, // commander
      null, // limited
    ]);
    expect(FORMATS.map((format) => formatRules(format).plannedCopyLimit)).toEqual([
      4, 4, 4, 4, 4, 4, 4, 1, 4,
    ]);
    expect(formatRules("limited").buildsFromOwnedPool).toBe(true);
    expect(FORMATS.filter((format) => formatRules(format).buildsFromOwnedPool)).toEqual([
      "limited",
    ]);
    for (const format of CONSTRUCTED) expect(formatRules(format).sideboardSize).toBe(15);
    for (const format of ["casual", "commander", "limited"] as const) {
      expect(formatRules(format).sideboardSize).toBeNull();
    }
  });

  it("gives Commander, and only Commander, the command zone and its rules", () => {
    const commanderOnly = (ask: (format: (typeof FORMATS)[number]) => boolean) =>
      FORMATS.filter(ask);
    expect(commanderOnly((format) => formatRules(format).hasCommandZone)).toEqual(["commander"]);
    expect(commanderOnly((format) => formatRules(format).usesColorIdentity)).toEqual(["commander"]);
    expect(commanderOnly((format) => formatRules(format).bracketsApply)).toEqual(["commander"]);
    expect(commanderOnly((format) => formatRules(format).freeFirstMulligan)).toEqual(["commander"]);
    expect(formatRules("commander").commandZoneTaxPerCast).toBe(2);
    expect(formatRules("modern").commandZoneTaxPerCast).toBe(0);
  });

  it("checks legality in constructed formats and Commander only", () => {
    expect(FORMATS.filter((format) => !formatRules(format).legalityChecked)).toEqual([
      "casual",
      "limited",
    ]);
    expect(FORMATS.filter((format) => formatRules(format).reportsShortDeck)).toEqual([
      ...CONSTRUCTED,
      "commander",
      "limited",
    ]);
    expect(FORMATS.filter((format) => formatRules(format).conspiraciesLeaveDeck)).toEqual([
      "limited",
    ]);
  });

  it("has role targets in Commander and 60-card formats, and none in Limited", () => {
    expect(formatRules("commander").roleTargets).toEqual({
      ramp: 10,
      draw: 10,
      removal: 8,
      wipe: 3,
    });
    for (const format of [...CONSTRUCTED, "casual"] as const) {
      expect(formatRules(format).roleTargets).toEqual(SIXTY_CARD_TARGETS);
    }
    expect(formatRules("limited").roleTargets).toBeNull();
    expect(formatRules("commander").roleGuideName).toBe("Commander");
    expect(formatRules("modern").roleGuideName).toBe("60-card");
  });

  it("guides curves", () => {
    expect(FORMATS.map((format) => formatRules(format).curveGuide)).toEqual([
      3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.3, 3.0,
    ]);
    expect(FORMATS.map((format) => formatRules(format).optimizerTargetManaValue)).toEqual([
      2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 3.1, 2.4,
    ]);
    expect(FORMATS.map((format) => formatRules(format).roleSlotSaturation)).toEqual([
      12, 12, 12, 12, 12, 12, 12, 20, 12,
    ]);
    expect(FORMATS.filter((format) => !formatRules(format).landTargetFollowsCurve)).toEqual([
      "limited",
    ]);
  });

  it("offers the draft button and the 60-card legality list where they make sense", () => {
    expect(FORMATS.filter((format) => !formatRules(format).canDraftDeck)).toEqual(["limited"]);
    expect(FORMATS.filter((format) => formatRules(format).hasConstructedVariants)).toEqual([
      "casual",
      ...CONSTRUCTED,
    ]);
  });

  it("treats a name that is not a format like Casual", () => {
    expect(formatRules("brawl")).toBe(FORMAT_RULES.casual);
    expect(formatRules("")).toBe(FORMAT_RULES.casual);
  });
});
