import type { BudgetReplacementsResult, SimilarCards, Suggestion } from "@/modules/decks";
import { reasonText } from "@/app/decks/labels";
import { money, moneyOrNull } from "../tool";
import { compactMoneyFields } from "./money";

// What find_replacements says: cards that might stand in for one card, or cheaper cards for the
// dear ones in a deck. They are ideas to consider, listed in the order the app's heuristics put
// them, with no score, rank or similarity number: those would make a guess sound like a fact.

/** The most reasons said per card: a short "why" is enough to decide whether to look. */
const REASONS_SHOWN = 3;

/** A reason in words, without the text-similarity percentage (a score by another name). */
function whyText(reason: Suggestion["reasons"][number]): string {
  return reason.kind === "embedSim" ? "Reads like the deck" : reasonText(reason);
}

function suggestionView(suggestion: Suggestion, includeText: boolean) {
  const card = suggestion.card;
  return {
    name: card.name,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    ...(includeText ? { text: card.text } : {}),
    ...(card.isGameChanger ? { isGameChanger: true } : {}),
    owned: card.owned,
    price: moneyOrNull(card.priceCents),
    why: suggestion.reasons.slice(0, REASONS_SHOWN).map(whyText),
  };
}

export function presentSimilarCards(result: SimilarCards, includeText: boolean): unknown {
  return compactMoneyFields({
    like: result.like,
    owned: result.owned.map((each) => suggestionView(each, includeText)),
    store: result.store.map((each) => suggestionView(each, includeText)),
    ...(result.hiddenOverTarget > 0 ? { hiddenOverTarget: result.hiddenOverTarget } : {}),
    ...(result.avoided.length > 0 ? { leftOutAvoid: result.avoided } : {}),
  });
}

export function presentBudgetReplacements(
  result: BudgetReplacementsResult,
  includeText: boolean,
): unknown {
  const pick = (entry: BudgetReplacementsResult["cards"][number]["owned"][number]) => ({
    name: entry.card.name,
    price: moneyOrNull(entry.card.priceCents),
    saved: money(entry.savedCents),
    ...(entry.matchedRoles.length > 0 ? { matchedRoles: entry.matchedRoles } : {}),
    ...(includeText ? { text: entry.card.text } : {}),
  });
  return compactMoneyFields({
    minPrice: money(result.minPriceCents),
    maxPrice: money(result.maxPriceCents),
    cards: result.cards.map((entry) => ({
      target: {
        name: entry.target.name,
        typeLine: entry.target.typeLine,
        price: money(entry.target.priceCents),
      },
      owned: entry.owned.map(pick),
      store: entry.store.map(pick),
    })),
  });
}
