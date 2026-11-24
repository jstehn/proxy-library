import type { CardLookup } from "@/modules/catalog";
import { money, priceCents } from "../tool";
import { compactMoneyFields } from "./money";

// What get_cards says (detail "full" and "compact"): the capability's answer reshaped for the
// model. Money is plain cents; a price point keeps its day beside `cents` and `text`.

type Found = Extract<CardLookup, { found: true }>;

function fullCard(card: CardLookup): Record<string, unknown> {
  if (!card.found) return { query: card.query, found: false };
  const point = (at: { day: string; price: number } | null) =>
    at === null ? null : { day: at.day, ...money(at.price) };
  return {
    query: card.query,
    found: true,
    name: card.card.name,
    oracleId: card.card.oracleId,
    printingId: card.card.printingId,
    typeLine: card.card.typeLine,
    manaCost: card.card.manaCost,
    colorIdentity: card.card.colorIdentity,
    faces: card.faces,
    set: card.set,
    priceTrend: card.priceTrend.map((trend) => ({
      finish: trend.finish,
      first: point(trend.first),
      latest: point(trend.latest),
      low: trend.low === null ? null : money(trend.low),
      high: trend.high === null ? null : money(trend.high),
    })),
    owned: card.owned,
    ownedOfThisPrinting: card.ownedOfThisPrinting,
    decksUsing: card.decksUsing,
    wishes: card.wishes.map((wish) => ({ wishId: wish.id, quantity: wish.quantity })),
    printingsForSale: card.printingsForSale.map((printing) => ({
      printingId: printing.printingId,
      set: printing.set,
      number: printing.number,
      variant: printing.variant,
      prices: Object.fromEntries(
        Object.entries(printing.prices).map(([finish, cents]) => [finish, money(cents)]),
      ),
    })),
  };
}

type CompactCardOptions = Readonly<{ includePrice: boolean; includeSets: boolean }>;

function compactCard(card: Found, options: CompactCardOptions) {
  const text = card.faces
    .map((face) => (face as { text?: string }).text ?? "")
    .filter(Boolean)
    .join("\n---\n");
  const cents = card.printingsForSale.flatMap((printing) => Object.values(printing.prices));
  const sets = options.includeSets
    ? (card.sets ?? [...new Set(card.printingsForSale.map((printing) => printing.set))].sort())
    : undefined;
  return {
    name: card.card.name,
    manaCost: card.card.manaCost,
    typeLine: card.card.typeLine,
    colorIdentity: card.card.colorIdentity,
    text,
    ownedGame: card.owned.game,
    ownedReal: card.owned.real,
    ...(options.includePrice
      ? { cheapestPriceCents: cents.length > 0 ? Math.min(...cents) : null }
      : {}),
    ...(sets !== undefined ? { sets } : {}),
    decksUsing: card.decksUsing,
    wishes: card.wishes.map((wish) => ({ wishId: wish.id, quantity: wish.quantity })),
  };
}

/** get_cards with detail "full": every field of every card. */
export function presentFullCards(cards: readonly CardLookup[]): unknown {
  return compactMoneyFields({ cards: cards.map(fullCard) });
}

/** get_cards with detail "compact" (the default): the short card, with price/sets only on request. */
export function presentCompactCards(
  cards: readonly CardLookup[],
  options: CompactCardOptions,
): unknown {
  return {
    cards: cards.map((card) =>
      card.found ? compactCard(card, options) : compactMoneyFields(fullCard(card)),
    ),
  };
}

/** get_cards with detail "owned": the quick batch check. */
export function presentOwnedCards(
  checked: ReadonlyArray<Record<string, unknown> & { inCatalog: boolean }>,
  includePrice: boolean,
): unknown {
  return {
    cards: checked.map((entry) =>
      entry.inCatalog
        ? {
            name: entry.name,
            inCatalog: true,
            ownedGame: entry.ownedGame,
            ownedReal: entry.ownedReal,
            ...(includePrice
              ? { priceCents: priceCents(entry.cheapestPriceCents as number | null) }
              : {}),
            decks: entry.decks,
          }
        : entry,
    ),
  };
}
