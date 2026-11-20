import type { BudgetReplacementsResult, SimilarCards, Suggestion } from "@/modules/decks";
import { reasonText } from "@/app/decks/labels";
import { money, moneyOrNull } from "../tool";
import { compactMoneyFields } from "./money";

// What find_replacements says: cards like one card, or cheaper cards for the dear ones in a deck.

function suggestionView(suggestion: Suggestion, includeText: boolean) {
  const card = suggestion.card;
  return {
    name: card.name,
    oracleId: card.oracleId,
    printingId: card.printingId,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    ...(includeText ? { text: card.text } : {}),
    ...(card.isGameChanger ? { isGameChanger: true } : {}),
    owned: card.owned,
    price: moneyOrNull(card.priceCents),
    why: suggestion.reasons.map(reasonText),
  };
}

export function presentSimilarCards(result: SimilarCards, includeText: boolean): unknown {
  return compactMoneyFields({
    like: result.like,
    owned: result.owned.map((each) => suggestionView(each, includeText)),
    store: result.store.map((each) => suggestionView(each, includeText)),
    hiddenOverTarget: result.hiddenOverTarget,
    ...(result.avoided.length > 0 ? { leftOutAvoid: result.avoided } : {}),
  });
}

export function presentBudgetReplacements(
  result: BudgetReplacementsResult,
  includeText: boolean,
): unknown {
  const pick = (entry: BudgetReplacementsResult["cards"][number]["owned"][number]) => ({
    name: entry.card.name,
    oracleId: entry.card.oracleId,
    price: moneyOrNull(entry.card.priceCents),
    saved: money(entry.savedCents),
    similarityPct: entry.similarityPct,
    rating: entry.rating,
    matchedRoles: entry.matchedRoles,
    ...(includeText ? { text: entry.card.text } : {}),
  });
  return compactMoneyFields({
    minPrice: money(result.minPriceCents),
    maxPrice: money(result.maxPriceCents),
    cards: result.cards.map((entry) => ({
      target: {
        name: entry.target.name,
        oracleId: entry.target.oracleId,
        typeLine: entry.target.typeLine,
        price: money(entry.target.priceCents),
      },
      owned: entry.owned.map(pick),
      store: entry.store.map(pick),
    })),
  });
}
