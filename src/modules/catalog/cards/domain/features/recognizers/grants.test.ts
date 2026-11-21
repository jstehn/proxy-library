import { describe, expect, it } from "vitest";
import { fixtureCard } from "../../../../../../../tests/fixtures/features/cards";
import { extractFeatures } from "../registry";

const featuresOf = (name: string) => extractFeatures(fixtureCard(name));

describe("grants and the haste theme", () => {
  it("finds equipment that gives haste", () => {
    const features = featuresOf("Lightning Greaves");
    expect(features.grants).toEqual(["Haste", "Shroud"]);
    expect(features.themes).toContain("haste");
    expect(features.signalIO.makes).toContain("haste");
    expect(features.signalIO.uses).not.toContain("haste");
  });

  it("finds an anthem that gives haste to others, and still uses haste itself", () => {
    const features = featuresOf("Goblin Chieftain");
    expect(features.grants).toEqual(["Haste"]);
    expect(features.leaderThemes).toContain("haste");
    expect(features.signalIO.makes).toContain("haste");
    expect(features.signalIO.uses).toContain("haste");
  });

  it("finds a spell that gives haste for a turn", () => {
    expect(featuresOf("Threaten").grants).toEqual(["Haste"]);
  });

  it("counts a blitz creature as using haste, but not as granting it (reminder text is not a rule)", () => {
    const features = featuresOf("Tenacious Underdog");
    expect(features.grants).toEqual([]);
    expect(features.signalIO.uses).toContain("haste");
    expect(features.signalIO.makes).not.toContain("haste");
    expect(features.themes).toContain("haste");
  });

  it("does not count a card giving itself an ability", () => {
    const features = featuresOf("Stormbreath Dragon");
    expect(features.grants).toEqual([]);
    expect(features.leaderThemes).not.toContain("haste");
  });

  it("gives other cards no haste", () => {
    expect(featuresOf("Sol Ring").grants).toEqual([]);
    expect(featuresOf("Sol Ring").themes).not.toContain("haste");
  });
});
