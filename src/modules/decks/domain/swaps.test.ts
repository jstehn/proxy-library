import { describe, expect, it } from "vitest";
import type { RankedCut } from "./cuts";
import type { Scored } from "./suggest";
import { suggestSwaps, type SwapCutMeta } from "./swaps";

function makeCut(
  oracleId: string,
  name: string,
  keepScore: number,
  overBracket = false,
): RankedCut {
  return {
    oracleId,
    name,
    keepScore,
    reasons: overBracket
      ? [{ kind: "overBracket", target: 2, flags: ["gameChanger"] }]
      : [{ kind: "noFit" }],
  };
}

function makeAdd(
  oracleId: string,
  name: string,
  rating: number,
  opts: { manaValue?: number; isGameChanger?: boolean; roles?: ("ramp" | "draw")[] } = {},
): Scored {
  return {
    card: {
      oracleId,
      name,
      typeLine: "Artifact",
      manaValue: opts.manaValue ?? 2,
      keywords: [],
      roles: opts.roles ?? [],
      themes: [],
      rarity: "uncommon",
      priceCents: 100,
      pool: "owned",
      isGameChanger: opts.isGameChanger ?? false,
    },
    score: rating,
    reasons: [],
    rating: { rating, logit: 0, parts: [] },
  };
}

describe("suggestSwaps", () => {
  it("pairs weakest cuts with highest-rated replacements and skips duplicates", () => {
    const cuts = [makeCut("c1", "Weak Card", 1.0), makeCut("c2", "Okay Card", 3.0)];
    const meta = new Map<string, SwapCutMeta>([
      ["c1", { manaValue: 6, rating: 25 }],
      ["c2", { manaValue: 3, rating: 55 }],
    ]);
    const candidates = [
      makeAdd("c2", "Already In Deck", 90),
      makeAdd("a1", "Strong Ramp", 80, { manaValue: 2, roles: ["ramp"] }),
      makeAdd("a2", "Decent Draw", 65, { manaValue: 2 }),
    ];

    const swaps = suggestSwaps(cuts, meta, candidates, {
      format: "commander",
      targetBracket: 3,
      existingOracleIds: new Set(["c1", "c2"]),
      neededRoles: new Set(["ramp"]),
    });

    expect(swaps).toHaveLength(2);
    expect(swaps[0].cut.oracleId).toBe("c1");
    expect(swaps[0].add.card.oracleId).toBe("a1");
    expect(swaps[0].reasons.some((r) => r.kind === "fillsRole" && r.tag === "ramp")).toBe(true);
    expect(swaps[0].reasons.some((r) => r.kind === "lowersCurve")).toBe(true);
    // c2 was filtered out because it is already in the Commander deck
    expect(swaps.every((s) => s.add.card.oracleId !== "c2")).toBe(true);
  });

  it("never suggests adding a Game Changer in bracket 1-2 and prioritizes fixing overBracket cuts", () => {
    const cuts = [makeCut("c1", "Rhystic Study", 0.5, true)];
    const meta = new Map<string, SwapCutMeta>([["c1", { manaValue: 3, rating: 90 }]]);
    const candidates = [
      makeAdd("gc", "Another Game Changer", 95, { isGameChanger: true }),
      makeAdd("fair", "Fair Draw Spell", 72),
    ];

    const swaps = suggestSwaps(cuts, meta, candidates, {
      format: "commander",
      targetBracket: 2,
      existingOracleIds: new Set(["c1"]),
    });

    expect(swaps).toHaveLength(1);
    expect(swaps[0].add.card.oracleId).toBe("fair");
    expect(swaps[0].reasons.some((r) => r.kind === "fixesOverBracket")).toBe(true);
  });

  it("never cuts basic lands or suggests negative-gain swaps without a problem fix", () => {
    const cuts = [makeCut("b1", "Forest", 0.1), makeCut("c1", "Good Card", 2.0)];
    const meta = new Map<string, SwapCutMeta>([
      ["b1", { manaValue: 0, rating: 50, isBasicLand: true }],
      ["c1", { manaValue: 2, rating: 85 }],
    ]);
    const candidates = [makeAdd("a1", "Worse Card", 60)];

    const swaps = suggestSwaps(cuts, meta, candidates, {
      format: "commander",
      targetBracket: 3,
      existingOracleIds: new Set(["b1", "c1"]),
    });

    expect(swaps).toHaveLength(0);
  });

  it("prefers role-preserving and effect-similar replacements over slightly higher-rated unrelated cards", () => {
    const cuts = [makeCut("c1", "Expensive Removal", 0.5)];
    const meta = new Map<string, SwapCutMeta>([
      ["c1", { manaValue: 4, rating: 50, roles: ["draw"] }],
    ]);
    const candidates = [
      makeAdd("unrelated", "Slightly Higher Value", 75, { roles: ["ramp"] }),
      makeAdd("draw-match", "Efficient Draw", 72, { roles: ["draw"] }),
    ];

    const swaps = suggestSwaps(cuts, meta, candidates, {
      format: "commander",
      targetBracket: 3,
      existingOracleIds: new Set(["c1"]),
      cutAddSimilarity: (_cutId, addId) => (addId === "draw-match" ? 0.85 : 0.4),
    });

    expect(swaps).toHaveLength(1);
    expect(swaps[0]?.add.card.oracleId).toBe("draw-match");
    expect(swaps[0]?.reasons.some((r) => r.kind === "preservesRole" && r.tag === "draw")).toBe(
      true,
    );
    expect(swaps[0]?.reasons.some((r) => r.kind === "similarEffect")).toBe(true);
  });
});
