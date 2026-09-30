import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PrintingId } from "@/modules/catalog";
import { seededRng } from "@/shared/kernel";
import {
  SAMPLE_BOOSTER,
  SAMPLE_FACTS,
  sampleFacts,
  samplePrintingId,
  sampleSheet,
  withSheet,
} from "../testing/recipes";
import { factsLookup } from "./pack";
import { packProblems } from "./checks";
import { ALL_COLORS, generatePack, openPack } from "./generate";

// The sample booster (testing/recipes.ts): 14 cards; a land in 3 of 4 packs, a foil in the
// other; a rare slot where mythics are 25%; six color-balanced commons; a fixed 3-card starter.

function pack(seed: string, config = SAMPLE_BOOSTER) {
  return generatePack(config, seededRng(seed), sampleFacts);
}

function idsFrom(sheet: string, seed: string, config = SAMPLE_BOOSTER): PrintingId[] {
  return pack(seed, config)
    .cards.filter((card) => card.sheet === sheet)
    .map((card) => card.printingId);
}

describe("generatePack", () => {
  it("follows the recipe for any seed (rules 2, 3, 4, 6)", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        expect(packProblems(SAMPLE_BOOSTER, pack(seed), sampleFacts)).toEqual([]);
      }),
    );
  });

  it("gives the same pack for the same seed (rule 1)", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        expect(pack(seed)).toEqual(pack(seed));
      }),
    );
  });

  it("gives different packs for different seeds", () => {
    const packs = new Set(["a", "b", "c", "d", "e"].map((seed) => JSON.stringify(pack(seed))));
    expect(packs.size).toBe(5);
  });

  it("includes a fixed sheet's cards exactly, in order, each `weight` times", () => {
    expect(idsFrom("starter", "any")).toEqual(["c-artifact", "c-artifact", "l-forest"]);
  });

  it("repeats a fixed sheet's list when the slot asks for more", () => {
    const config = withSheet("starter", SAMPLE_BOOSTER.sheets.starter, { starter: 5 });
    expect(idsFrom("starter", "any", config)).toEqual([
      "c-artifact",
      "c-artifact",
      "l-forest",
      "c-artifact",
      "c-artifact",
    ]);
  });

  it("can repeat a card when the sheet allows duplicates", () => {
    // Five draws from two lands: at least one must repeat.
    const config = withSheet("land", SAMPLE_BOOSTER.sheets.land, { land: 5 });
    const lands = idsFrom("land", "any", config);
    expect(lands).toHaveLength(5);
    expect(new Set(lands).size).toBeLessThan(5);
  });

  it("never repeats a card within a draw otherwise", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const commons = idsFrom("common", seed);
        expect(new Set(commons).size).toBe(commons.length);
      }),
    );
  });

  it("never repeats a card between slots of one rarity (rule 3b)", () => {
    // A common-or-uncommon slot beside the commons and uncommons, like Reality Fracture's:
    // every card it can give is also on one of those sheets.
    const flex = sampleSheet([
      ["c-W1", 1],
      ["c-U1", 1],
      ["c-B1", 1],
      ["u-1", 1],
      ["u-2", 1],
    ]);
    const config = {
      ...withSheet("commonUncommon", flex, { common: 6, commonUncommon: 1, uncommon: 3 }),
    };
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const ids = pack(seed, config).cards.map((card) => card.printingId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(packProblems(config, pack(seed, config), sampleFacts)).toEqual([]);
      }),
    );
  });

  it("never gives two versions of one card from one slot (rule 3)", () => {
    // A foil uncommon slot listing each uncommon twice: regular and showcase art (same name).
    const withShowcases = new Map(SAMPLE_FACTS);
    for (const n of [1, 2, 3, 4]) {
      const regular = SAMPLE_FACTS.get(samplePrintingId(`u-${n}`));
      if (regular) withShowcases.set(samplePrintingId(`u-${n}-showcase`), regular);
    }
    const facts = factsLookup(withShowcases);
    const sheet = sampleSheet(
      [1, 2, 3, 4].flatMap((n): Array<[string, number]> => [
        [`u-${n}`, 1],
        [`u-${n}-showcase`, 1],
      ]),
      { isFoil: true },
    );
    const config = withSheet("foilUncommon", sheet, { foilUncommon: 3 });
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const generated = generatePack(config, seededRng(seed), facts);
        const names = generated.cards.map((card) => facts(card.printingId).name);
        expect(new Set(names).size).toBe(3);
        expect(packProblems(config, generated, facts)).toEqual([]);
      }),
    );
  });

  it("still lets an any-rarity slot (wildcard, foil) repeat another slot's card", () => {
    // A nonfoil wildcard with commons and rares: over many packs it sometimes matches a common.
    const wildcard = sampleSheet([
      ["c-W1", 1],
      ["c-U1", 1],
      ["r-1", 1],
    ]);
    const config = withSheet("wildcard", wildcard, { common: 6, wildcard: 1 });
    const repeats = Array.from({ length: 300 }, (_, n) => pack(`wild-${n}`, config)).filter(
      (generated) => {
        const ids = generated.cards.map((card) => card.printingId);
        return new Set(ids).size < ids.length;
      },
    );
    expect(repeats.length).toBeGreaterThan(0);
    expect(packProblems(config, repeats[0], sampleFacts)).toEqual([]);
  });

  it("the pack check reports a repeat between slots of one rarity", () => {
    const flex = sampleSheet([["c-W1", 1]]);
    const config = withSheet("commonUncommon", flex, { common: 1, commonUncommon: 1 });
    const repeated = {
      variantIndex: 0,
      cards: [
        { printingId: "c-W1", finish: "nonfoil", sheet: "common" },
        { printingId: "c-W1", finish: "nonfoil", sheet: "commonUncommon" },
      ],
    } as unknown as ReturnType<typeof pack>;
    expect(packProblems(config, repeated, sampleFacts)).toEqual([
      'c-W1 came from both "common" and "commonUncommon"',
    ]);
  });

  it("draws fixed lists first, then the rest in name order, whatever the recipe's key order", () => {
    const reordered = {
      ...SAMPLE_BOOSTER,
      variants: SAMPLE_BOOSTER.variants.map((variant) => ({
        ...variant,
        slots: Object.fromEntries(Object.entries(variant.slots).reverse()),
      })),
    };
    expect(pack("order", reordered)).toEqual(pack("order"));
  });

  it("throws for a slot whose sheet doesn't exist (a broken recipe is a bug)", () => {
    const broken = { ...SAMPLE_BOOSTER, variants: [{ weight: 1, slots: { missing: 1 } }] };
    expect(() => pack("any", broken)).toThrow(/no sheet named "missing"/);
  });
});

describe("finishes (rule 4)", () => {
  it("foil sheets give foils, and regular sheets give nonfoils", () => {
    for (const seed of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      for (const card of pack(seed).cards) {
        const onlyFinishes = sampleFacts(card.printingId).finishes;
        if (card.sheet === "foil") {
          expect(card.finish).toBe(onlyFinishes.includes("foil") ? "foil" : "etched");
        } else if (onlyFinishes.includes("nonfoil")) {
          expect(card.finish).toBe("nonfoil");
        }
      }
    }
  });

  it("an etched-only mythic comes out etched even from a regular sheet", () => {
    const config = withSheet("rareMythic", sampleSheet([["m-etched", 1]]), { rareMythic: 1 });
    expect(pack("any", config).cards[0].finish).toBe("etched");
  });
});

describe("color balance (rule 5)", () => {
  function colorsIn(printingIds: readonly PrintingId[]): Set<string> {
    return new Set(
      printingIds.flatMap((id) => {
        const colors = sampleFacts(id).colors;
        return colors.length === 1 ? colors : [];
      }),
    );
  }

  it("always shows all five colors among the commons when it can", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        expect(colorsIn(idsFrom("common", seed)).size).toBe(ALL_COLORS.length);
      }),
    );
  });

  it("is really doing something: without it, some packs miss a color", () => {
    const unbalanced = withSheet(
      "common",
      { ...SAMPLE_BOOSTER.sheets.common, balanceColors: false },
      { common: 6 },
    );
    const seeds = Array.from({ length: 200 }, (_, index) => `seed-${index}`);
    const missingAColor = seeds.filter(
      (seed) => colorsIn(idsFrom("common", seed, unbalanced)).size < ALL_COLORS.length,
    );
    expect(missingAColor.length).toBeGreaterThan(100); // about 76% of packs
  });

  it("keeps the first draw when the sheet can't show every color", () => {
    // No green cards at all: balancing is impossible, so it must not redraw.
    const noGreen = SAMPLE_BOOSTER.sheets.common.cards.filter(
      (card) => !card.printingId.startsWith("c-G"),
    );
    const balanced = sampleSheet(
      noGreen.map((card) => [card.printingId, card.weight]),
      { balanceColors: true },
    );
    const plain = { ...balanced, balanceColors: false };
    const seed = "impossible";
    expect(idsFrom("common", seed, withSheet("common", balanced, { common: 6 }))).toEqual(
      idsFrom("common", seed, withSheet("common", plain, { common: 6 })),
    );
  });
});

describe("the odds (statistics)", () => {
  // With n packs, a rate p wobbles by about one "standard error", sqrt(p × (1 − p) ÷ n), from
  // run to run. Allowing 4 standard errors means a correct engine fails this test about once
  // in 16,000 runs, and the seeds are fixed, so it never flakes.
  const PACKS = 20_000;
  const packs = Array.from({ length: PACKS }, (_, index) => pack(`stats-${index}`));

  function expectRate(observedCount: number, expectedRate: number) {
    const standardError = Math.sqrt((expectedRate * (1 - expectedRate)) / PACKS);
    expect(Math.abs(observedCount / PACKS - expectedRate)).toBeLessThan(4 * standardError);
  }

  it("rolls each layout in proportion to its weight (3 : 1)", () => {
    expectRate(packs.filter((generated) => generated.variantIndex === 0).length, 0.75);
  });

  it("gives a mythic in the rare slot 2 times in 8", () => {
    const mythics = packs.filter((generated) =>
      generated.cards.some(
        (card) => card.sheet === "rareMythic" && sampleFacts(card.printingId).rarity === "mythic",
      ),
    );
    expectRate(mythics.length, 0.25);
  });

  it("keeps each card's odds on the foil sheet even (1 in 20)", () => {
    const foilPacks = packs.filter((generated) => generated.variantIndex === 1);
    const artifactFoils = foilPacks.filter((generated) =>
      generated.cards.some((card) => card.sheet === "foil" && card.printingId === "c-artifact"),
    );
    const rate = artifactFoils.length / foilPacks.length;
    const standardError = Math.sqrt((0.05 * 0.95) / foilPacks.length);
    expect(Math.abs(rate - 0.05)).toBeLessThan(4 * standardError);
  });
});

describe("openPack", () => {
  it("stores the seed and puts the cards in reveal order", () => {
    const opened = openPack(SAMPLE_BOOSTER, sampleFacts, "reveal");
    expect(opened.seed).toBe("reveal");
    expect(opened.setCode).toBe("TST");
    expect(opened.cards).toHaveLength(14);
    const last = sampleFacts(opened.cards[13].printingId);
    expect(["rare", "mythic"]).toContain(last.rarity);
  });
});
