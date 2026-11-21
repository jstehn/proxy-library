import { describe, expect, it } from "vitest";
import { extractFeatures, RECOGNIZERS } from "./registry";
import { allFixtureCards } from "../../../../../../tests/fixtures/features/cards";
import { FEATURES_VERSION } from "./version";

describe("the recognizer registry", () => {
  it("has unique ids and one owner per field", () => {
    const ids = RECOGNIZERS.map((recognizer) => recognizer.id);
    const fields = RECOGNIZERS.map((recognizer) => recognizer.field);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("fills every field of CardFeatures and stamps the version", () => {
    const features = extractFeatures(allFixtureCards()[0]);
    expect(Object.keys(features).sort()).toEqual(
      ["featuresVersion", ...RECOGNIZERS.map((recognizer) => recognizer.field)].sort(),
    );
    expect(features.featuresVersion).toBe(FEATURES_VERSION);
  });

  it("gives the same answer twice", () => {
    for (const card of allFixtureCards()) {
      expect(extractFeatures(card)).toEqual(extractFeatures(card));
    }
  });
});
