import { describe, expect, it } from "vitest";
import type { Color } from "@/modules/catalog";
import { Cents } from "@/shared/kernel";
import { sampleCardFacts, samplePick, samplePrintingId } from "../testing/samples";
import {
  cardStrength,
  chooseAutoPick,
  colorFit,
  commitment,
  pickScore,
  topColors,
  type DraftCardFacts,
} from "./auto-pick";
import type { DraftCard } from "./draft";

/** A pack or pool built from facts: printing ids are "card0", "card1", … */
function cardsFrom(facts: readonly DraftCardFacts[], prefix: string, picked = false): DraftCard[] {
  return facts.map((_, slot) => ({
    slot,
    printingId: samplePrintingId(`${prefix}${slot}`),
    finish: "nonfoil",
    pick: picked ? samplePick(0, slot + 1) : null,
    cameFrom: null,
  }));
}

function choose(pack: DraftCardFacts[], pool: DraftCardFacts[]): number {
  const all = new Map<string, DraftCardFacts>();
  pack.forEach((facts, slot) => all.set(`pack${slot}`, facts));
  pool.forEach((facts, slot) => all.set(`pool${slot}`, facts));
  return chooseAutoPick({ cards: cardsFrom(pack, "pack") }, cardsFrom(pool, "pool", true), (id) =>
    all.get(id),
  );
}

const mono = (color: Color, count: number) =>
  Array.from({ length: count }, () => sampleCardFacts({ colors: [color] }));

describe("card strength", () => {
  it("ranks by rarity, nudged by price, with basics worth nothing", () => {
    const common = cardStrength(sampleCardFacts({ rarity: "common" }));
    const rare = cardStrength(sampleCardFacts({ rarity: "rare" }));
    const pricyCommon = cardStrength(
      sampleCardFacts({ rarity: "common", marketPrice: Cents.of(900) }),
    );
    expect(rare).toBeGreaterThan(pricyCommon);
    expect(pricyCommon).toBeGreaterThan(common);
    expect(cardStrength(sampleCardFacts({ typeLine: "Basic Land — Forest" }))).toBe(0);
  });
});

describe("colors", () => {
  it("finds the pool's two main colors", () => {
    expect(topColors([...mono("G", 3), ...mono("U", 2), ...mono("R", 1)])).toEqual(["G", "U"]);
    expect(topColors([])).toEqual([]);
  });

  it("commits slowly: nothing for three picks, fully by pick 13", () => {
    expect([0, 2, 3, 7, 12, 30].map(commitment)).toEqual([0, 0, 0.1, 0.5, 1, 1]);
  });

  it("rewards fitting, keeps a second color open, and penalizes a third", () => {
    const red = sampleCardFacts({ colors: ["R"] });
    expect(colorFit(red, ["R", "G"], 1)).toBeCloseTo(1.2);
    expect(colorFit(red, ["G"], 1)).toBe(1); // second color still open
    expect(colorFit(red, ["G", "U"], 1)).toBeCloseTo(0.3);
    expect(colorFit(red, ["G", "U"], 0)).toBe(1); // early: no penalty
    expect(colorFit(sampleCardFacts({ colors: [] }), ["G", "U"], 1)).toBe(1);
  });
});

describe("chooseAutoPick", () => {
  const strongRed = sampleCardFacts({ name: "Bolt", colors: ["R"], rarity: "rare" });
  const goodGreen = sampleCardFacts({ name: "Bear", colors: ["G"], rarity: "uncommon" });

  it("takes the strongest card early", () => {
    expect(choose([goodGreen, strongRed], [])).toBe(1);
  });

  it("stays in its colors later, over a slightly stronger off-color card", () => {
    const pool = [...mono("G", 6), ...mono("U", 6)];
    expect(choose([strongRed, goodGreen], pool)).toBe(1);
  });

  it("wants creatures and fills gaps in the curve", () => {
    const pool = [...mono("G", 6), ...mono("U", 6)].map((facts) => ({
      ...facts,
      typeLine: "Instant",
      manaValue: 2,
    }));
    const twoDropSpell = sampleCardFacts({ colors: ["G"], typeLine: "Instant", manaValue: 2 });
    const fourDropCreature = sampleCardFacts({ colors: ["G"], manaValue: 4 });
    expect(pickScore(fourDropCreature, pool)).toBeGreaterThan(pickScore(twoDropSpell, pool));
    expect(choose([twoDropSpell, fourDropCreature], pool)).toBe(1);
  });

  it("is deterministic: a tie goes to the earliest slot", () => {
    expect(choose([goodGreen, goodGreen, goodGreen], [])).toBe(0);
  });

  it("values a dual land in its colors once settled", () => {
    const pool = [...mono("G", 6), ...mono("U", 6)];
    const dual = sampleCardFacts({ typeLine: "Land", colors: [], producedMana: ["G", "U"] });
    const offDual = sampleCardFacts({ typeLine: "Land", colors: [], producedMana: ["R", "W"] });
    expect(pickScore(dual, pool)).toBeGreaterThan(pickScore(offDual, pool));
  });
});
