import { describe, expect, it } from "vitest";
import { clampInclusionRate, clampSynergy, commanderSlug, dedupeEdhrecEntries } from "./edhrec";

describe("commanderSlug", () => {
  it("formats standard, punctuated, and accented commander names", () => {
    expect(commanderSlug("Atraxa, Praetors' Voice")).toBe("atraxa-praetors-voice");
    expect(commanderSlug("K'rrik, Son of Yawgmoth")).toBe("krrik-son-of-yawgmoth");
    expect(commanderSlug("Niv-Mizzet, Parun")).toBe("niv-mizzet-parun");
    expect(commanderSlug("Lim-Dûl the Necromancer")).toBe("lim-dul-the-necromancer");
    expect(commanderSlug("The Ur-Dragon")).toBe("the-ur-dragon");
  });

  it("uses only the front face for double-faced commanders", () => {
    expect(commanderSlug("Esika, God of the Tree // The Prismatic Bridge")).toBe(
      "esika-god-of-the-tree",
    );
  });
});

describe("clamping", () => {
  it("clamps inclusionRate to [0, 1] and synergy to [-1, 1]", () => {
    expect(clampInclusionRate(-0.2)).toBe(0);
    expect(clampInclusionRate(1.5)).toBe(1);
    expect(clampInclusionRate(Number.NaN)).toBe(0);
    expect(clampSynergy(-1.5)).toBe(-1);
    expect(clampSynergy(1.5)).toBe(1);
    expect(clampSynergy(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("dedupeEdhrecEntries", () => {
  it("keeps the entry with highest numDecks (then synergy) per card name", () => {
    const result = dedupeEdhrecEntries([
      {
        cardName: "Sol Ring",
        numDecks: 100,
        potentialDecks: 200,
        inclusionRate: 0.5,
        synergy: 0.1,
      },
      {
        cardName: "sol ring",
        numDecks: 150,
        potentialDecks: 200,
        inclusionRate: 0.75,
        synergy: 0.05,
      },
      {
        cardName: "Arcane Signet",
        numDecks: 120,
        potentialDecks: 200,
        inclusionRate: 0.6,
        synergy: 0.02,
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((e) => e.cardName.toLowerCase() === "sol ring")?.numDecks).toBe(150);
  });
});
