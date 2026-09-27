import { Cents } from "@/shared/kernel";
import { marketValue, type FactsLookup, type PackCard, type PrintingFacts } from "./pack";

// Reveal order: "build suspense" (design doc 05, rule 8).

/** Which group a card is revealed in: 1 first, 5 last. */
export function revealTier(card: PackCard, printing: PrintingFacts): number {
  const isCommonOrUncommon = printing.rarity === "common" || printing.rarity === "uncommon";
  if (!isCommonOrUncommon) return 5; // rares, mythics, specials, bonus cards: any finish
  if (card.finish !== "nonfoil") return 4; // foil commons and uncommons
  if (printing.isBasicLand) return 3;
  return printing.rarity === "common" ? 1 : 2;
}

/**
 * The cards in the order they're revealed: by tier, then cheapest first, then by collector
 * number, so the most valuable card is always the last flip. Doesn't change its input.
 */
export function revealOrder(cards: readonly PackCard[], facts: FactsLookup): PackCard[] {
  const withSortKeys = cards.map((card) => {
    const printing = facts(card.printingId);
    return {
      card,
      tier: revealTier(card, printing),
      price: marketValue(card, facts),
      collectorNumber: printing.collectorNumber,
    };
  });

  withSortKeys.sort(
    (a, b) =>
      a.tier - b.tier ||
      Cents.subtract(a.price, b.price) ||
      // "numeric" sorts "9" before "10", like the numbers printed on the cards.
      a.collectorNumber.localeCompare(b.collectorNumber, "en", { numeric: true }) ||
      a.card.printingId.localeCompare(b.card.printingId),
  );
  return withSortKeys.map((entry) => entry.card);
}
