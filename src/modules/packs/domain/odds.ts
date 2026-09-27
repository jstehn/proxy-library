import type { BoosterConfig, BoosterSheet, PrintingId, Rarity } from "@/modules/catalog";
import { finishFor, type FactsLookup, type PackCard } from "./pack";

// What a recipe promises, and what a pile of opened packs actually delivered (design doc 05,
// section 3). The Pack lab shows the two side by side; the statistical tests compare them.

/** A rarity, or "foil" for foil and etched cards of any rarity. */
export type CountKey = Rarity | "foil";
/** Cards per pack of each rarity, plus how many are foil (or etched). */
export type PerPackCounts = Readonly<Record<CountKey, number>>;

export const COUNT_KEYS: readonly CountKey[] = [
  "common",
  "uncommon",
  "rare",
  "mythic",
  "special",
  "bonus",
  "foil",
];

function emptyCounts(): Record<CountKey, number> {
  return { common: 0, uncommon: 0, rare: 0, mythic: 0, special: 0, bonus: 0, foil: 0 };
}

/**
 * How many copies of each printing one slot yields on average. A fixed sheet yields exactly
 * its listed cards; a random one yields `count × weight ÷ total weight` of each card.
 */
function expectedCopies(
  sheet: BoosterSheet,
  count: number,
): Array<{ printingId: PrintingId; copies: number }> {
  if (sheet.isFixed) {
    const everyCopy = sheet.cards.flatMap((card) =>
      Array.from({ length: card.weight }, () => card.printingId),
    );
    return Array.from({ length: count }, (_, index) => ({
      printingId: everyCopy[index % everyCopy.length],
      copies: 1,
    }));
  }
  const totalWeight = sheet.cards.reduce((total, card) => total + card.weight, 0);
  return sheet.cards.map((card) => ({
    printingId: card.printingId,
    copies: (count * card.weight) / totalWeight,
  }));
}

/**
 * The average pack, calculated exactly from the recipe's weights (no simulation). Each variant
 * counts in proportion to its weight. Exact for single-card slots and single-rarity sheets,
 * which covers the slots that matter (rare/mythic, wildcard, foil).
 */
export function expectedPerPack(config: BoosterConfig, facts: FactsLookup): PerPackCounts {
  const expected = emptyCounts();
  const totalVariantWeight = config.variants.reduce((total, variant) => total + variant.weight, 0);

  for (const variant of config.variants) {
    const variantShare = variant.weight / totalVariantWeight;
    for (const [sheetName, count] of Object.entries(variant.slots)) {
      const sheet = config.sheets[sheetName];
      for (const { printingId, copies } of expectedCopies(sheet, count)) {
        const printing = facts(printingId);
        expected[printing.rarity] += variantShare * copies;
        if (finishFor(sheetName, sheet, printing.finishes) !== "nonfoil") {
          expected.foil += variantShare * copies;
        }
      }
    }
  }
  return expected;
}

/** The average of what these packs actually contained. */
export function observedPerPack(
  packs: ReadonlyArray<readonly PackCard[]>,
  facts: FactsLookup,
): PerPackCounts {
  const observed = emptyCounts();
  if (packs.length === 0) return observed;
  for (const cards of packs) {
    for (const card of cards) {
      observed[facts(card.printingId).rarity] += 1;
      if (card.finish !== "nonfoil") observed.foil += 1;
    }
  }
  for (const key of COUNT_KEYS) observed[key] /= packs.length;
  return observed;
}
