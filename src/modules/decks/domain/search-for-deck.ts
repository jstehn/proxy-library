import type { Tag, Theme } from "@/shared/card-search";

// Searching for a deck with several synergy queries at once (design doc 28, section 3.3): the
// pure half. The queries run in ../queries/search-for-deck.ts; this merges their hits into one
// list per card, ranks it (rule 13) and says what to do about a query that found too little or
// too much (rule 14).

/** At most this many queries per call, cards per query, and merged cards (rule 7). */
export const SEARCH_FOR_DECK_LIMITS = { queries: 8, perQuery: 50, merged: 200 } as const;

/** One search the caller wrote for one idea. */
export type SynergyQuery = Readonly<{ synergy: string; search: string }>;

/** Where to look: your cards, the store's (cards you don't own), or both. */
export const SEARCH_POOLS = ["owned", "store", "both"] as const;
export type SearchPool = (typeof SEARCH_POOLS)[number];

/** A card one query found. */
export type FoundCard = Readonly<{
  oracleId: string;
  /** The copy to use: your most special one, or the store's cheapest printing. */
  printingId: string;
  name: string;
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  text: string;
  roleTags: readonly Tag[];
  themes: readonly Theme[];
  /** On Wizards' Game Changer list (design doc 31). */
  isGameChanger: boolean;
  /** Copies you can put in this deck (real ones too when the deck uses them). */
  owned: number;
  /** The store's price for the printing above, in cents; null when it isn't for sale. */
  priceCents: number | null;
}>;

/** What one query found, before merging. */
export type QueryHits = Readonly<{
  query: SynergyQuery;
  /** Distinct cards matching, before the cap. */
  found: number;
  cards: readonly FoundCard[];
  /** The parser's notes about parts it ignored. */
  notes: readonly string[];
}>;

/** A card in the merged result, with every synergy it matched (in query order). */
export type MergedCard = FoundCard & Readonly<{ synergies: readonly string[] }>;

export type QueryReport = Readonly<{
  synergy: string;
  search: string;
  found: number;
  shown: number;
  capped: boolean;
  notes: readonly string[];
  hint: string | null;
}>;

/** One entry per card (by oracle id), listing each synergy that found it once. */
export function mergeHits(hits: readonly QueryHits[]): MergedCard[] {
  const merged = new Map<string, { card: FoundCard; synergies: string[] }>();
  for (const { query, cards } of hits) {
    for (const card of cards) {
      const entry = merged.get(card.oracleId);
      if (entry === undefined) {
        merged.set(card.oracleId, { card, synergies: [query.synergy] });
      } else {
        if (!entry.synergies.includes(query.synergy)) entry.synergies.push(query.synergy);
        // An owned copy beats the store's offer of the same card.
        if (card.owned > entry.card.owned) entry.card = card;
      }
    }
  }
  return [...merged.values()].map(({ card, synergies }) => ({ ...card, synergies }));
}

/** Rule 13: more synergies first, then owned before store-only, then cheaper, then by name. */
export function rankFound(cards: readonly MergedCard[]): MergedCard[] {
  const price = (card: MergedCard) => (card.owned > 0 ? 0 : (card.priceCents ?? Infinity));
  return [...cards].sort(
    (a, b) =>
      b.synergies.length - a.synergies.length ||
      Number(b.owned > 0) - Number(a.owned > 0) ||
      price(a) - price(b) ||
      a.name.localeCompare(b.name) ||
      a.oracleId.localeCompare(b.oracleId),
  );
}

/** Rule 14: what to tell the caller about a query that found nothing or hit the cap. */
export function queryHint(hits: QueryHits, perQuery: number): string | null {
  if (hits.found === 0) {
    const ignored = hits.notes.length > 0 ? " Some of it was ignored: see notes." : "";
    return `Found nothing. Loosen it: drop a term, shorten a /pattern/ or a phrase, or try a synonym.${ignored}`;
  }
  if (hits.found > perQuery) {
    return `Found ${hits.found}; showing ${perQuery}. Narrow it with t:, mv<=, tag:, theme: or a longer phrase.`;
  }
  return null;
}

/** Reports in query order, and the merged, ranked cards, at most `merged` of them. */
export function searchForDeckResult(
  hits: readonly QueryHits[],
  perQuery: number,
): { queries: QueryReport[]; cards: MergedCard[] } {
  const queries = hits.map((each) => ({
    synergy: each.query.synergy,
    search: each.query.search,
    found: each.found,
    shown: each.cards.length,
    capped: each.found > each.cards.length,
    notes: each.notes,
    hint: queryHint(each, perQuery),
  }));
  const cards = rankFound(mergeHits(hits)).slice(0, SEARCH_FOR_DECK_LIMITS.merged);
  return { queries, cards };
}
