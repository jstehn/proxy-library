import { describe, expect, it } from "vitest";
import type { OptimizerCard } from "./optimize";
import { buildUpgradeRoadmap, type UpgradeCandidate, type UpgradeCut } from "./upgrade-roadmap";

function makeCard(
  oracleId: string,
  name: string,
  opts: Partial<OptimizerCard> = {},
): OptimizerCard {
  return {
    oracleId,
    name,
    typeLine: opts.typeLine ?? "Creature — Elf",
    manaValue: opts.manaValue ?? 2,
    manaCost: opts.manaCost ?? "{1}{G}",
    text: opts.text ?? "",
    producedMana: opts.producedMana ?? [],
    keywords: opts.keywords ?? [],
    roles: opts.roles ?? [],
    themes: opts.themes ?? [],
    rarity: opts.rarity ?? "rare",
    priceCents: opts.priceCents ?? 100,
    board: opts.board ?? "main",
    quantity: opts.quantity ?? 1,
    edhrecRank: opts.edhrecRank ?? 500,
  };
}

describe("buildUpgradeRoadmap (design doc 57)", () => {
  it("allocates non-overlapping swaps across budget tiers and computes scoreDelta", () => {
    const currentDeck: OptimizerCard[] = [
      makeCard("cmd", "Lathril, Blade of the Elves", {
        board: "commander",
        typeLine: "Legendary Creature — Elf Noble",
        manaValue: 4,
      }),
      makeCard("cut1", "Vanilla Bear", { manaValue: 5, text: "" }),
      makeCard("cut2", "Overcosted Wurm", { manaValue: 6, text: "" }),
      makeCard("cut3", "Weak Spell", { manaValue: 5, text: "" }),
      makeCard("land1", "Forest", {
        typeLine: "Basic Land — Forest",
        manaValue: 0,
        producedMana: ["G"],
        quantity: 35,
      }),
    ];

    const cuts: UpgradeCut[] = [
      { oracleId: "cut1", name: "Vanilla Bear", keepScore: 10, manaValue: 5, roles: [] },
      { oracleId: "cut2", name: "Overcosted Wurm", keepScore: 15, manaValue: 6, roles: [] },
      { oracleId: "cut3", name: "Weak Spell", keepScore: 20, manaValue: 5, roles: [] },
    ];

    const candidates: UpgradeCandidate[] = [
      {
        card: makeCard("add1", "Llanowar Elves", {
          manaValue: 1,
          roles: ["ramp"],
          text: "{T}: Add {G}.",
          edhrecRank: 50,
          priceCents: 1500,
        }),
        rating: 90,
        reasons: ["fills ramp"],
        priceCents: 1500,
      },
      {
        card: makeCard("add2", "Beast Whisperer", {
          manaValue: 4,
          roles: ["draw"],
          text: "Whenever you cast a creature spell, draw a card.",
          edhrecRank: 80,
          priceCents: 5000,
        }),
        rating: 85,
        reasons: ["fills draw"],
        priceCents: 5000,
      },
      {
        card: makeCard("add3", "Craterhoof Behemoth", {
          manaValue: 8,
          roles: [],
          text: "Trample. Creatures you control get +X/+X.",
          edhrecRank: 40,
          priceCents: 12000,
        }),
        rating: 80,
        reasons: ["finisher"],
        priceCents: 12000,
      },
    ];

    const roadmap = buildUpgradeRoadmap({
      format: "commander",
      targetBracket: 3,
      currentDeck,
      cuts,
      candidates,
      tiersCents: [2500, 7500, 20000],
    });

    expect(roadmap.tiers).toHaveLength(3);
    expect(roadmap.tiers[0].swaps.map((s) => s.add.card.oracleId)).toEqual(["add1"]);
    expect(roadmap.tiers[0].cumulativeSpentCents).toBe(1500);

    expect(roadmap.tiers[1].swaps.map((s) => s.add.card.oracleId)).toEqual(["add2"]);
    expect(roadmap.tiers[1].cumulativeSpentCents).toBe(6500);

    expect(roadmap.tiers[2].swaps.map((s) => s.add.card.oracleId)).toEqual(["add3"]);
    expect(roadmap.tiers[2].cumulativeSpentCents).toBe(18500);
    expect(roadmap.tiers[2].scoreAfter.total).toBeGreaterThan(roadmap.baseScore.total);
    expect(roadmap.tiers[2].scoreDeltaFromBase).toBeGreaterThan(0);
  });
});
