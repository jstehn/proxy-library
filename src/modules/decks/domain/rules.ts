import type { Color } from "@/modules/catalog";
import type { Deck, DeckEntry, Format } from "./deck";

// What's wrong with a deck (design doc 09, rules 1–5). Pure: the caller supplies what the rules
// need to know about each card, and how many copies the player owns. Problems are reported, never
// enforced.

/** What the rules need to know about one oracle card. */
export type CardRules = Readonly<{
  name: string;
  typeLine: string;
  /** Rules text of every face, for "can be your commander" and "any number of cards named". */
  text: string;
  colorIdentity: readonly Color[];
  legalities: Readonly<Record<string, string>>; // Scryfall's, e.g. { modern: "legal" }
  isBasicLand: boolean;
}>;

export type RulesLookup = (oracleId: string) => CardRules;
export type OwnedLookup = (oracleId: string) => number;

export type DeckProblem =
  | Readonly<{ kind: "Short"; oracleId: string; name: string; needed: number; owned: number }>
  | Readonly<{ kind: "TooFewCards"; minimum: number; count: number }>
  | Readonly<{ kind: "WrongSize"; required: number; count: number }>
  | Readonly<{ kind: "SideboardTooBig"; maximum: number; count: number }>
  | Readonly<{ kind: "TooManyCopies"; name: string; maximum: number; count: number }>
  | Readonly<{ kind: "NotLegal"; name: string; status: string }>
  | Readonly<{ kind: "CommanderMissing" }>
  | Readonly<{ kind: "TooManyCommanders"; count: number }>
  | Readonly<{ kind: "CommanderInvalid"; name: string }>
  | Readonly<{ kind: "OutsideColorIdentity"; name: string }>;

/** Each format's shape, in one table (the Strategy idea, as data). */
type FormatRules =
  | Readonly<{ kind: "casual" }>
  | Readonly<{ kind: "constructed"; minimum: number; sideboard: number; copies: number }>
  | Readonly<{ kind: "commander"; size: number }>;

const FORMAT_RULES: Record<Format, FormatRules> = {
  casual: { kind: "casual" },
  standard: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  pioneer: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  modern: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  legacy: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  vintage: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  pauper: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  commander: { kind: "commander", size: 100 },
};

/** Cards with no copy limit: basic lands, and "A deck can have any number of cards named …". */
function isUnlimited(card: CardRules): boolean {
  return card.isBasicLand || /a deck can have any number of cards named/i.test(card.text);
}

function canBeCommander(card: CardRules): boolean {
  return (
    (/\bLegendary\b/.test(card.typeLine) && /\bCreature\b/.test(card.typeLine)) ||
    /can be your commander/i.test(card.text)
  );
}

/** Copies of each oracle card across every board. */
function copiesByCard(entries: readonly DeckEntry[]): Map<string, number> {
  const copies = new Map<string, number>();
  for (const entry of entries) {
    copies.set(entry.oracleId, (copies.get(entry.oracleId) ?? 0) + entry.quantity);
  }
  return copies;
}

const count = (entries: readonly DeckEntry[]) =>
  entries.reduce((total, entry) => total + entry.quantity, 0);

/** Rule 1: every card you use, you own (basic lands excepted). */
function ownershipProblems(
  copies: ReadonlyMap<string, number>,
  rules: RulesLookup,
  owned: OwnedLookup,
): DeckProblem[] {
  const problems: DeckProblem[] = [];
  for (const [oracleId, needed] of copies) {
    const card = rules(oracleId);
    if (card.isBasicLand) continue;
    const have = owned(oracleId);
    if (have < needed)
      problems.push({ kind: "Short", oracleId, name: card.name, needed, owned: have });
  }
  return problems;
}

/** Legal (or restricted, as one copy) in the format, per Scryfall's legalities. */
function legalityProblems(
  format: Format,
  copies: ReadonlyMap<string, number>,
  rules: RulesLookup,
): DeckProblem[] {
  const problems: DeckProblem[] = [];
  for (const [oracleId, quantity] of copies) {
    const card = rules(oracleId);
    const status = card.legalities[format] ?? "not_legal";
    if (status === "legal") continue;
    if (status === "restricted") {
      if (quantity > 1)
        problems.push({ kind: "TooManyCopies", name: card.name, maximum: 1, count: quantity });
      continue;
    }
    problems.push({ kind: "NotLegal", name: card.name, status });
  }
  return problems;
}

function copyLimitProblems(
  copies: ReadonlyMap<string, number>,
  rules: RulesLookup,
  maximum: number,
): DeckProblem[] {
  const problems: DeckProblem[] = [];
  for (const [oracleId, quantity] of copies) {
    const card = rules(oracleId);
    if (quantity > maximum && !isUnlimited(card)) {
      problems.push({ kind: "TooManyCopies", name: card.name, maximum, count: quantity });
    }
  }
  return problems;
}

function commanderProblems(deck: Deck, rules: RulesLookup, size: number): DeckProblem[] {
  const problems: DeckProblem[] = [];
  const commanders = deck.entries.filter((entry) => entry.board === "commander");
  const commanderCount = count(commanders);
  const total = count(deck.entries.filter((entry) => entry.board !== "side"));

  if (commanderCount === 0) problems.push({ kind: "CommanderMissing" });
  if (commanderCount > 2) problems.push({ kind: "TooManyCommanders", count: commanderCount });
  if (total !== size) problems.push({ kind: "WrongSize", required: size, count: total });

  const identity = new Set<string>();
  for (const commander of commanders) {
    const card = rules(commander.oracleId);
    if (!canBeCommander(card)) problems.push({ kind: "CommanderInvalid", name: card.name });
    for (const color of card.colorIdentity) identity.add(color);
  }
  if (commanderCount > 0) {
    for (const entry of deck.entries) {
      const card = rules(entry.oracleId);
      if (card.colorIdentity.some((color) => !identity.has(color))) {
        problems.push({ kind: "OutsideColorIdentity", name: card.name });
      }
    }
  }
  return problems;
}

/** Everything wrong with a deck, ownership first. An empty list means it's ready to play. */
export function deckProblems(deck: Deck, rules: RulesLookup, owned: OwnedLookup): DeckProblem[] {
  const copies = copiesByCard(deck.entries);
  const problems = ownershipProblems(copies, rules, owned);
  const format = FORMAT_RULES[deck.format];

  switch (format.kind) {
    case "casual":
      return problems;
    case "constructed": {
      const main = count(deck.entries.filter((entry) => entry.board !== "side"));
      const side = count(deck.entries.filter((entry) => entry.board === "side"));
      if (main < format.minimum)
        problems.push({ kind: "TooFewCards", minimum: format.minimum, count: main });
      if (side > format.sideboard) {
        problems.push({ kind: "SideboardTooBig", maximum: format.sideboard, count: side });
      }
      problems.push(...copyLimitProblems(copies, rules, format.copies));
      problems.push(...legalityProblems(deck.format, copies, rules));
      return problems;
    }
    case "commander":
      problems.push(...commanderProblems(deck, rules, format.size));
      problems.push(...copyLimitProblems(copies, rules, 1));
      problems.push(...legalityProblems(deck.format, copies, rules));
      return problems;
  }
}

/** How many cards short a deck is, in total (for the "short 3" badge). */
export function shortCount(problems: readonly DeckProblem[]): number {
  return problems.reduce(
    (total, problem) => total + (problem.kind === "Short" ? problem.needed - problem.owned : 0),
    0,
  );
}
