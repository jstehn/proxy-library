import type { CatalogSearch } from "@/modules/catalog";
import type {
  CatalogSynergySearch,
  SearchForDeck,
  SearchSignals,
  SemanticSearchResult,
} from "@/modules/decks";
import { moneyOrNull, priceCents } from "../tool";
import { compactMoneyFields } from "./money";

// What search_cards says in each of its four modes. Money is plain cents; prices and rules text
// appear only when asked for.

type Signals = Readonly<{ cardCount: number; signals: unknown; notes?: readonly string[] }>;

/** Mode "signals": what the deck's (or your search's) cards keep doing. */
export function presentSignals(result: Signals | SearchSignals): unknown {
  return result;
}

/** Mode "semantic": cards matching a described effect. */
export function presentSemantic(
  result: SemanticSearchResult,
  owned: SemanticSearchResult["owned"],
  store: SemanticSearchResult["store"],
  avoided: readonly string[],
  includeText: boolean,
): unknown {
  // Ideas in the order the search put them: no similarity or rating number, which would make a
  // guess sound like a fact.
  const pick = (each: SemanticSearchResult["owned"][number]) => ({
    name: each.card.name,
    typeLine: each.card.typeLine,
    manaCost: each.card.manaCost,
    price: moneyOrNull(each.card.priceCents),
    ...(includeText ? { text: each.card.text } : {}),
  });
  return compactMoneyFields({
    concept: result.concept,
    owned: owned.map(pick),
    store: store.map(pick),
    ...(result.hiddenOverTarget > 0 ? { hiddenOverTarget: result.hiddenOverTarget } : {}),
    ...(avoided.length > 0 ? { leftOutAvoid: avoided } : {}),
  });
}

type SynergyCard = SearchForDeck["cards"][number];

function presentSynergyCard(
  card: SynergyCard,
  options: Readonly<{ includeText: boolean; showPrice: boolean }>,
) {
  return {
    name: card.name,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    ...(options.includeText && card.text ? { text: card.text } : {}),
    owned: card.owned,
    ...(options.showPrice ? { priceCents: priceCents(card.priceCents) } : {}),
    synergies: card.synergies,
    ...(card.isGameChanger ? { isGameChanger: true } : {}),
  };
}

/** Mode "syntax" with a deck: one search per synergy, cards merged. */
export function presentDeckSearch(
  result: SearchForDeck,
  cards: SearchForDeck["cards"],
  avoided: readonly string[],
  options: Readonly<{ includeText: boolean; showPrice: boolean }>,
): unknown {
  return {
    deck: result.deck,
    leftOutOverTarget: result.leftOutOverTarget,
    ...(avoided.length > 0 ? { leftOutAvoid: avoided } : {}),
    goal: null,
    queries: result.queries,
    cards: cards.map((card) => presentSynergyCard(card, options)),
  };
}

/** Mode "syntax" with batched synergy queries and no deck: cards merged across queries. */
export function presentCatalogQueries(
  result: CatalogSynergySearch,
  options: Readonly<{ includeText: boolean; showPrice: boolean }>,
): unknown {
  return {
    queries: result.queries,
    cards: result.cards.map((card) => presentSynergyCard(card, options)),
  };
}

/** Mode "syntax" without a deck: your collection or the store, paged. */
export function presentCatalogSearch(
  result: CatalogSearch,
  options: Readonly<{ includeText: boolean; showPrice: boolean; limit: number }>,
): unknown {
  if (result.kind === "owned") {
    return {
      notes: result.notes,
      totals: result.totals,
      pageCount: result.pageCount,
      cards: result.cards.slice(0, options.limit).map((card) => ({
        name: card.name,
        ...(card.set ? { set: card.set } : {}),
        source: card.source,
        quantity: card.quantity,
        ...(options.includeText && card.text ? { text: card.text } : {}),
        ...(options.showPrice ? { priceCents: priceCents(card.price) } : {}),
      })),
    };
  }
  return {
    notes: result.notes,
    total: result.total,
    pageCount: result.pageCount,
    cards: result.cards.slice(0, options.limit).map((card) => ({
      name: card.name,
      ...(card.set ? { set: card.set } : {}),
      ...(options.includeText && card.text ? { text: card.text } : {}),
      ...(options.showPrice ? { priceCents: priceCents(card.cheapest) } : {}),
    })),
  };
}
