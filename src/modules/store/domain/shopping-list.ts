import type { Finish } from "@/modules/catalog";
import type { ListLine } from "@/shared/card-search";

// Buying a list of singles (design doc 15, section 3): which printing each line buys, how many,
// and why a line can't be bought. Pure: the catalog's answers come in, a quote comes out.

/** At most this many lines in one list (rule 5). */
export const MAX_LIST_LINES = 250;

export type PrintingPreference = "cheapest" | "newest";

export type QuoteOptions = Readonly<{
  preference: PrintingPreference;
  /** Buy only the copies you don't own yet (decision 2: on by default). */
  onlyMissing: boolean;
  /** Printings picked by hand on the screen, by line number (from 0). */
  chosen: Readonly<Record<number, string>>;
}>;

/** One printing for sale in one finish, at its current market price. */
export type Candidate = Readonly<{
  printingId: string;
  oracleId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  /** "Showcase", "Borderless · Galaxy Foil", or "" for a regular printing. */
  variantLabel: string;
  releaseDate: string;
  finish: Finish;
  priceCents: number;
}>;

/** What the catalog knows about the names in a list (gathered by the store's query). */
export type CatalogAnswers = Readonly<{
  /** Printings for sale (enabled sets, priced), by lower-cased name and front-face name. */
  forSale: ReadonlyMap<string, readonly Candidate[]>;
  /** Lower-cased names (and front-face names) the catalog has at all, for sale or not. */
  known: ReadonlySet<string>;
  /** Copies the player owns, of any printing, by oracle card. */
  owned: ReadonlyMap<string, number>;
}>;

export type QuoteLine = Readonly<{
  /** The line's number among the readable lines (from 0): how the screen refers to it. */
  index: number;
  request: ListLine;
  finish: Finish;
  /** The printing it would buy, or null when the line can't be bought. */
  choice: Candidate | null;
  /** Every printing of this card for sale in this finish, cheapest first (the screen's menu). */
  options: readonly Candidate[];
  owned: number;
  /** Copies to buy: the request, less what you own when only buying what's missing. */
  toBuy: number;
  totalCents: number;
  /** Why it can't be bought, in words; null when it can (or when you own enough already). */
  problem: string | null;
}>;

export type ListQuote = Readonly<{
  lines: readonly QuoteLine[];
  /** Lines that weren't a card ("hello world"), shown back to the player. */
  unreadable: readonly string[];
  /** Readable lines past the limit, left out. */
  leftOut: number;
  totalCents: number;
  cards: number;
}>;

/** How a list line names a card, matched without regard to case. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function cheapestFirst(a: Candidate, b: Candidate): number {
  return a.priceCents - b.priceCents || b.releaseDate.localeCompare(a.releaseDate);
}

function newestFirst(a: Candidate, b: Candidate): number {
  return b.releaseDate.localeCompare(a.releaseDate) || a.priceCents - b.priceCents;
}

/** Why no printing fits, in words. */
function problemFor(
  request: ListLine,
  finish: Finish,
  allForSale: readonly Candidate[],
  isKnown: boolean,
): string {
  if (!isKnown) return "no card by that name";
  if (allForSale.length === 0) return "not sold here (its sets aren't in the store)";
  const finishes = [...new Set(allForSale.map((candidate) => candidate.finish))];
  if (!finishes.includes(finish)) {
    const markers = finishes.map((other) =>
      other === "nonfoil" ? "no marker" : `*${other[0].toUpperCase()}*`,
    );
    return `no ${finish} printing for sale (sold as ${finishes.join(", ")}: mark it ${markers.join(" or ")})`;
  }
  if (request.collectorNumber !== null) {
    return `no ${finish} printing ${request.setCode} #${request.collectorNumber} for sale`;
  }
  return `no ${finish} printing from ${request.setCode} for sale`;
}

/**
 * The quote for a parsed list: for each line, the printing (rule order: set and number, then
 * set, then the preference; a printing picked on the screen wins), and how many to buy.
 */
export function quoteList(
  lines: readonly ListLine[],
  unreadable: readonly string[],
  answers: CatalogAnswers,
  options: QuoteOptions,
): ListQuote {
  const kept = lines.slice(0, MAX_LIST_LINES);
  // Owned copies are used up line by line, so "4 Bolt" twice doesn't count the same copies twice.
  const ownedLeft = new Map(answers.owned);

  const quoted = kept.map((request, index): QuoteLine => {
    const finish: Finish = request.finish ?? "nonfoil";
    const key = nameKey(request.name);
    const allForSale = answers.forSale.get(key) ?? [];
    const inFinish = allForSale
      .filter((candidate) => candidate.finish === finish)
      .sort(cheapestFirst);

    const inSet =
      request.setCode === null
        ? inFinish
        : inFinish.filter((candidate) => candidate.setCode === request.setCode);
    const exact =
      request.collectorNumber === null
        ? inSet
        : inSet.filter(
            (candidate) =>
              candidate.collectorNumber.toLowerCase() === request.collectorNumber?.toLowerCase(),
          );
    const byPreference = [...exact].sort(
      options.preference === "newest" ? newestFirst : cheapestFirst,
    );
    const picked = inFinish.find((candidate) => candidate.printingId === options.chosen[index]);
    const choice = picked ?? byPreference[0] ?? null;

    if (choice === null) {
      return {
        index,
        request,
        finish,
        choice: null,
        options: inFinish,
        owned: 0,
        toBuy: 0,
        totalCents: 0,
        problem: problemFor(request, finish, allForSale, answers.known.has(key)),
      };
    }
    const owned = ownedLeft.get(choice.oracleId) ?? 0;
    const covered = options.onlyMissing ? Math.min(owned, request.quantity) : 0;
    ownedLeft.set(choice.oracleId, owned - covered);
    const toBuy = request.quantity - covered;
    return {
      index,
      request,
      finish,
      choice,
      options: inFinish,
      owned: answers.owned.get(choice.oracleId) ?? 0,
      toBuy,
      totalCents: toBuy * choice.priceCents,
      problem: null,
    };
  });

  return {
    lines: quoted,
    unreadable,
    leftOut: Math.max(0, lines.length - MAX_LIST_LINES),
    totalCents: quoted.reduce((sum, line) => sum + line.totalCents, 0),
    cards: quoted.reduce((sum, line) => sum + line.toBuy, 0),
  };
}
