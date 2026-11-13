import { describe, expect, it } from "vitest";
import { emptyRatingProfile } from "./rate";
import { rankBudgetReplacements } from "./replacements";
import type { CandidateCard } from "./suggest";

function makeCard(overrides: Partial<CandidateCard> = {}): CandidateCard {
  return {
    oracleId: "oracle-1",
    name: "Test Card",
    typeLine: "Instant",
    manaValue: 2,
    text: "Draw two cards.",
    keywords: [],
    roles: ["draw"],
    themes: [],
    rarity: "common",
    priceCents: 100,
    pool: "store",
    ...overrides,
  };
}

describe("rankBudgetReplacements", () => {
  const profile = emptyRatingProfile("commander");

  it("filters out cards without prices, cards >= target price, and cards over maxPriceCents", () => {
    const ranked = rankBudgetReplacements(
      { priceCents: 1500 },
      [
        { card: makeCard({ oracleId: "unpriced", priceCents: null }), similarity: 0.95 },
        { card: makeCard({ oracleId: "same", priceCents: 1500 }), similarity: 0.95 },
        { card: makeCard({ oracleId: "over-cap", priceCents: 300 }), similarity: 0.95 },
        { card: makeCard({ oracleId: "valid", priceCents: 150 }), similarity: 0.85 },
      ],
      profile,
      { maxPriceCents: 200 },
    );

    expect(ranked.map((r) => r.card.oracleId)).toEqual(["valid"]);
    expect(ranked[0]?.savedCents).toBe(1350);
    expect(ranked[0]?.similarityPct).toBe(85);
  });

  it("ranks by blended similarity and deck rating, breaking ties deterministically", () => {
    const ranked = rankBudgetReplacements(
      { priceCents: 2000 },
      [
        { card: makeCard({ oracleId: "b", priceCents: 100 }), similarity: 0.8 },
        { card: makeCard({ oracleId: "a", priceCents: 100 }), similarity: 0.8 },
        { card: makeCard({ oracleId: "best", priceCents: 150 }), similarity: 0.92 },
      ],
      profile,
      { maxPriceCents: 200 },
    );

    expect(ranked.map((r) => r.card.oracleId)).toEqual(["best", "a", "b"]);
  });
});
