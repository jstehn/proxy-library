import type { BoosterSheet, Color, Finish, PrintingId, Rarity, SetCode } from "@/modules/catalog";
import { Cents } from "@/shared/kernel";

// The pack engine's vocabulary (design doc 05, section 3).

/** One card pulled from a pack. */
export type PackCard = Readonly<{
  printingId: PrintingId;
  finish: Finish;
  sheet: string; // which sheet it came from, e.g. "rareMythic", "foil"
}>;

/** An opened pack. Its seed is enough to generate exactly the same pack again (ADR 0008). */
export type Pack = Readonly<{
  setCode: SetCode;
  boosterType: string;
  seed: string;
  variantIndex: number;
  cards: readonly PackCard[]; // in reveal order
}>;

/** What the engine needs to know about each printing a recipe can produce. */
export type PrintingFacts = Readonly<{
  name: string;
  collectorNumber: string;
  rarity: Rarity;
  colors: readonly Color[];
  finishes: readonly Finish[];
  isBasicLand: boolean;
  /** Latest market price per finish; missing when there's no price for that finish. */
  marketPrice: Readonly<Partial<Record<Finish, Cents>>>;
}>;

/** Looks up a printing's facts. Throws for a printing it doesn't know: that's a bug, not bad luck. */
export type FactsLookup = (printingId: PrintingId) => PrintingFacts;

export function factsLookup(facts: ReadonlyMap<PrintingId, PrintingFacts>): FactsLookup {
  function lookup(printingId: PrintingId): PrintingFacts {
    const found = facts.get(printingId);
    if (found === undefined) {
      throw new Error(`No facts for printing ${printingId}: the recipe uses a card we don't have`);
    }
    return found;
  }
  return lookup;
}

type SheetFinish = "regular" | "foil" | "etched";

/** The finishes to try, best first, for each kind of sheet. */
const FINISH_PREFERENCE: Record<SheetFinish, readonly Finish[]> = {
  regular: ["nonfoil", "foil", "etched"],
  foil: ["foil", "etched", "nonfoil"],
  etched: ["etched", "foil", "nonfoil"],
};

function sheetFinish(sheetName: string, sheet: BoosterSheet): SheetFinish {
  if (!sheet.isFoil) return "regular";
  return /etched/i.test(sheetName) ? "etched" : "foil";
}

/**
 * The finish a card comes out in (rule 4). A foil sheet gives foil, and a foil sheet named
 * "…etched…" gives etched. A regular sheet gives nonfoil. When the printing doesn't exist in
 * that finish (a foil-only promo on a regular sheet, say), it comes out in the next best
 * finish it does have.
 */
export function finishFor(
  sheetName: string,
  sheet: BoosterSheet,
  printingFinishes: readonly Finish[],
): Finish {
  const preference = FINISH_PREFERENCE[sheetFinish(sheetName, sheet)];
  return preference.find((finish) => printingFinishes.includes(finish)) ?? preference[0];
}

/** A card's market value in the finish it was pulled in (no price counts as $0). */
export function marketValue(card: PackCard, facts: FactsLookup): Cents {
  return facts(card.printingId).marketPrice[card.finish] ?? Cents.zero;
}

/** Every printing a recipe's sheets can produce, each once. */
export function printingsInSheets(sheets: Readonly<Record<string, BoosterSheet>>): PrintingId[] {
  const unique = new Set<PrintingId>();
  for (const sheet of Object.values(sheets)) {
    for (const card of sheet.cards) unique.add(card.printingId);
  }
  return [...unique];
}
