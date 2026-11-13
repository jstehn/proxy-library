import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  fitLogisticWeights,
  powerTierForBracket,
  qualityPrior,
  rateCard,
  RATING_BIAS,
  RATING_WEIGHTS,
  ratingFeatureVector,
  sigmoid,
  weightsForBracket,
  type RatingCandidate,
  type RatingProfile,
} from "./rate";
import { deckSignalProfile } from "./signals";

const emptyProfile: RatingProfile = {
  format: "commander",
  themes: [],
  tribes: [],
  gaps: [{ tag: "ramp", count: 2, target: 10 }],
  keywords: [],
  signals: deckSignalProfile([]),
  averageManaValue: 3.1,
  curveCounts: new Map(),
};

const baseCard: RatingCandidate = {
  oracleId: "card-1",
  name: "Arcane Signet",
  typeLine: "Artifact",
  manaValue: 2,
  text: "{T}: Add one mana of any color in your commander's color identity.",
  keywords: [],
  roles: ["ramp"],
  themes: [],
  rarity: "common",
  priceCents: 150,
  edhrecRank: 2,
  preconCount: 25,
};

describe("sigmoid & invariants", () => {
  it("maps 0 to 0.5 and is monotonic", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(2)).toBeGreaterThan(sigmoid(0));
    expect(sigmoid(-2)).toBeLessThan(sigmoid(0));
  });

  it("always keeps rating in [0, 100] and logit equal to bias + sum(parts)", () => {
    fc.assert(
      fc.property(
        fc.record({
          manaValue: fc.integer({ min: 0, max: 12 }),
          edhrecRank: fc.option(fc.integer({ min: 1, max: 30000 }), { nil: null }),
          preconCount: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
          synergy: fc.double({ min: -1, max: 1, noNaN: true }),
          inclusionRate: fc.double({ min: 0, max: 1, noNaN: true }),
          totalDecks: fc.integer({ min: 0, max: 5000 }),
        }),
        (sample) => {
          const result = rateCard(
            {
              ...baseCard,
              manaValue: sample.manaValue,
              edhrecRank: sample.edhrecRank,
              preconCount: sample.preconCount,
              edhrec: {
                inclusionRate: sample.inclusionRate,
                synergy: sample.synergy,
                totalDecks: sample.totalDecks,
              },
            },
            emptyProfile,
          );
          expect(result.rating).toBeGreaterThanOrEqual(0);
          expect(result.rating).toBeLessThanOrEqual(100);
          expect(Number.isInteger(result.rating)).toBe(true);
          const partSum = result.parts.reduce((sum, p) => sum + p.contribution, 0);
          expect(result.logit).toBeCloseTo(RATING_BIAS + partSum, 10);
        },
      ),
    );
  });
});

describe("qualityPrior", () => {
  it("ranks top EDHREC staples higher than obscure cards", () => {
    const solRing = qualityPrior({
      edhrecRank: 1,
      preconCount: 40,
      rarity: "uncommon",
      priceCents: 150,
    });
    const draftChaff = qualityPrior({
      edhrecRank: 20000,
      preconCount: 0,
      rarity: "common",
      priceCents: 10,
    });
    expect(solRing).toBeGreaterThan(0.9);
    expect(draftChaff).toBeLessThan(0.15);
  });
});

describe("rateCard rich signals", () => {
  it("gives higher rating to a card with EDHREC synergy, role need, and quality than an off-plan card", () => {
    const high = rateCard(
      {
        ...baseCard,
        edhrec: { inclusionRate: 0.72, synergy: 0.35, totalDecks: 1200 },
      },
      emptyProfile,
    );
    const low = rateCard(
      {
        oracleId: "chaff",
        name: "Colossal Dreadmaw",
        typeLine: "Creature — Dinosaur",
        manaValue: 6,
        text: "Trample",
        keywords: ["Trample"],
        roles: [],
        themes: [],
        rarity: "common",
        priceCents: 5,
        edhrecRank: 18000,
        preconCount: 0,
      },
      { ...emptyProfile, averageManaValue: 3.8 },
    );
    expect(high.rating).toBeGreaterThan(75);
    expect(low.rating).toBeLessThan(35);
    expect(high.parts.some((p) => p.kind === "roleNeed")).toBe(true);
    expect(high.parts.some((p) => p.kind === "edhrec")).toBe(true);
    expect(low.parts.some((p) => p.kind === "curvePenalty")).toBe(true);
  });

  it("applies pricePenalty when price exceeds maxCardPriceCents", () => {
    const expensive = rateCard({ ...baseCard, priceCents: 2500 }, emptyProfile, {
      maxCardPriceCents: 500,
    });
    const cheap = rateCard({ ...baseCard, priceCents: 150 }, emptyProfile, {
      maxCardPriceCents: 500,
    });
    expect(expensive.parts.some((p) => p.kind === "pricePenalty")).toBe(true);
    expect(expensive.rating).toBeLessThan(cheap.rating);
  });

  it("penalizes strongly negative EDHREC synergy with sufficient sample size", () => {
    const negative = rateCard(
      {
        ...baseCard,
        roles: [],
        edhrec: { inclusionRate: 0.02, synergy: -0.25, totalDecks: 500 },
      },
      emptyProfile,
    );
    expect(negative.parts.some((p) => p.kind === "edhrec" && p.contribution < 0)).toBe(true);
  });

  it("rewards embedSim above the baseline and ignores baseline/null embedSim", () => {
    const baseline = rateCard({ ...baseCard, roles: [], embedSim: 0.5 }, emptyProfile);
    const highSim = rateCard({ ...baseCard, roles: [], embedSim: 0.8 }, emptyProfile);
    expect(baseline.parts.some((p) => p.kind === "embedSim")).toBe(false);
    expect(highSim.parts.some((p) => p.kind === "embedSim" && p.contribution > 0)).toBe(true);
    expect(highSim.rating).toBeGreaterThan(baseline.rating);
  });
});

describe("powerTierForBracket & weightsForBracket", () => {
  it("maps brackets to the three power tiers", () => {
    expect(powerTierForBracket(1)).toBe("casual");
    expect(powerTierForBracket(2)).toBe("casual");
    expect(powerTierForBracket(3)).toBe("upgraded");
    expect(powerTierForBracket(null)).toBe("upgraded");
    expect(powerTierForBracket(4)).toBe("optimized");
    expect(powerTierForBracket(5)).toBe("optimized");
  });

  it("weights theme higher in casual and quality higher in optimized", () => {
    const casual = weightsForBracket(2);
    const optimized = weightsForBracket(4);
    expect(casual.theme).toBeGreaterThan(optimized.theme);
    expect(optimized.quality).toBeGreaterThan(casual.quality);
  });

  it("ratingFeatureVector matches rateCard features and fitLogisticWeights preserves signs", () => {
    const features = ratingFeatureVector(
      { ...baseCard, roles: ["ramp"], embedSim: 0.8 },
      { ...emptyProfile, gaps: [{ tag: "ramp", count: 2, target: 10 }] },
    );
    expect(features.roleNeed).toBeGreaterThan(0);
    expect(features.embedSimDelta).toBeCloseTo(0.25, 5);

    const negFeatures = ratingFeatureVector(
      {
        ...baseCard,
        roles: [],
        edhrecRank: null,
        preconCount: null,
        priceCents: 0,
        rarity: "common",
      },
      emptyProfile,
    );
    const fitted = fitLogisticWeights(
      [
        { features, label: 1 },
        { features: negFeatures, label: 0 },
      ],
      RATING_WEIGHTS,
      { epochs: 20 },
    );
    expect(fitted.embedSim).toBeGreaterThan(0);
    expect(fitted.topHeavyPenalty).toBeLessThanOrEqual(0);
  });
});
