import type { Color } from "@/modules/catalog";
import { isCounted, isPlayed } from "./boards";
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
  /** Whether a face has a printed power and toughness (a Spacecraft or Vehicle can). */
  hasPowerToughness: boolean;
}>;

export type RulesLookup = (oracleId: string) => CardRules;
/** What the rules read from a deck: its format and lines (the builder has no more than this). */
export type DeckToCheck = Pick<Deck, "format" | "entries">;
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
  | Readonly<{ kind: "CommandersCantPair"; names: readonly [string, string] }>
  | Readonly<{ kind: "OutsideColorIdentity"; name: string }>;

/** Each format's shape, in one table (the Strategy idea, as data). */
type FormatRules =
  | Readonly<{ kind: "casual" }>
  | Readonly<{ kind: "constructed"; minimum: number; sideboard: number; copies: number }>
  | Readonly<{ kind: "commander"; size: number }>
  | Readonly<{ kind: "limited"; minimum: number }>;

const FORMAT_RULES: Record<Format, FormatRules> = {
  casual: { kind: "casual" },
  standard: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  pioneer: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  modern: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  legacy: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  vintage: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  pauper: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  commander: { kind: "commander", size: 100 },
  // Draft and sealed: 40 cards, as many copies as you opened, any card (design doc 17).
  limited: { kind: "limited", minimum: 40 },
};

/** Cards with no copy limit: basic lands, and "A deck can have any number of cards named …". */
function isUnlimited(card: Pick<CardRules, "isBasicLand" | "text">): boolean {
  return card.isBasicLand || /a deck can have any number of cards named/i.test(card.text);
}

/**
 * Whether a card can lead a Commander deck on its own (Commander rule 903.3):
 * - a legendary creature;
 * - a legendary Vehicle or Spacecraft with a printed power and toughness (allowed since Edge of
 *   Eternities, 2025: Hearthhull, the Worldseed, a Spacecraft, leads its precon);
 * - or a card that says it "can be your commander".
 * Checked against every precon's commanders in the catalog by `pnpm worker check-commanders`.
 */
export function canBeCommander(
  card: Pick<CardRules, "typeLine" | "text" | "hasPowerToughness">,
): boolean {
  const isLegendary = /\bLegendary\b/.test(card.typeLine);
  return (
    (isLegendary && /\bCreature\b/.test(card.typeLine)) ||
    (isLegendary && /\b(Vehicle|Spacecraft)\b/.test(card.typeLine) && card.hasPowerToughness) ||
    /can be your commander/i.test(card.text)
  );
}

/** A Background can be the second commander, beside one that says "Choose a Background". */
function isBackground(card: Pick<CardRules, "typeLine">): boolean {
  return /\bLegendary\b/.test(card.typeLine) && /\bBackground\b/.test(card.typeLine);
}

/** The names of the commanders that may not lead this deck (an empty list means all may). */
export function invalidCommanders(commanders: readonly CardRules[]): string[] {
  const choosesBackground = commanders.some((card) => /choose a background/i.test(card.text));
  return commanders
    .filter((card) => !canBeCommander(card) && !(isBackground(card) && choosesBackground))
    .map((card) => card.name);
}

type PairCard = Pick<CardRules, "name" | "typeLine" | "text">;

/** What a card says about sharing the command zone (Commander rules 702.124, 903.3c). */
type PairAbilities = Readonly<{
  partner: boolean;
  partnerWith: string | null;
  partnerVariant: string | null;
  friendsForever: boolean;
  choosesBackground: boolean;
  doctorsCompanion: boolean;
}>;

/**
 * Keywords are matched with their capital letter, so reminder text ("if both have partner") never
 * counts. A name ends at its reminder's "(", a line break, or the end of the text.
 */
function pairAbilities(card: PairCard): PairAbilities {
  const partnerWith = /\bPartner with ([^(\n]+?)\s*(?:\(|\n|$)/.exec(card.text);
  const variant = /\bPartner—([^(\n]+?)\s*(?:\(|\n|$)/.exec(card.text);
  return {
    partner: /\bPartner\b(?! with)(?!—)/.test(card.text),
    partnerWith: partnerWith === null ? null : partnerWith[1].trim(),
    partnerVariant: variant === null ? null : variant[1].trim(),
    friendsForever: /\bFriends forever\b/.test(card.text),
    choosesBackground: /\bChoose a Background\b/i.test(card.text),
    doctorsCompanion: /\bDoctor's companion\b/.test(card.text),
  };
}

/** A legendary Time Lord Doctor creature with no other creature types (rule 702.124k). */
function isTheDoctor(card: PairCard): boolean {
  const front = card.typeLine.split(" // ")[0];
  const [types, subtypes = ""] = front.split("—").map((part) => part.trim());
  return (
    /\bLegendary\b/.test(types) &&
    /\bCreature\b/.test(types) &&
    subtypes.split(/\s+/).join(" ") === "Time Lord Doctor"
  );
}

/** Whether `name` is the card's name or its front face's name. */
function isNamed(card: PairCard, name: string): boolean {
  return card.name === name || card.name.split(" // ")[0] === name;
}

/** Whether two commanders may share the command zone, in either order. */
function canPair(first: PairCard, second: PairCard): boolean {
  const a = pairAbilities(first);
  const b = pairAbilities(second);
  const oneWay = (x: PairAbilities, xCard: PairCard, y: PairAbilities, yCard: PairCard) =>
    (x.partnerWith !== null &&
      y.partnerWith !== null &&
      isNamed(yCard, x.partnerWith) &&
      isNamed(xCard, y.partnerWith)) ||
    (x.choosesBackground && isBackground(yCard)) ||
    (x.doctorsCompanion && isTheDoctor(yCard));
  return (
    (a.partner && b.partner) ||
    (a.partnerVariant !== null && a.partnerVariant === b.partnerVariant) ||
    (a.friendsForever && b.friendsForever) ||
    oneWay(a, first, b, second) ||
    oneWay(b, second, a, first)
  );
}

/**
 * The pairing problem of a deck's commanders (design doc 40, section 2), or null: only two
 * commanders can have one. One leads alone; three or more are already too many.
 */
export function pairProblem(commanders: readonly PairCard[]): DeckProblem | null {
  if (commanders.length !== 2) return null;
  const [first, second] = commanders;
  if (canPair(first, second)) return null;
  return { kind: "CommandersCantPair", names: [first.name, second.name] };
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

function commanderProblems(deck: DeckToCheck, rules: RulesLookup, size: number): DeckProblem[] {
  const problems: DeckProblem[] = [];
  const commanders = deck.entries.filter((entry) => entry.board === "commander");
  const commanderCount = count(commanders);
  const total = count(deck.entries.filter((entry) => isPlayed(entry.board)));

  if (commanderCount === 0) problems.push({ kind: "CommanderMissing" });
  if (commanderCount > 2) problems.push({ kind: "TooManyCommanders", count: commanderCount });
  if (total !== size) problems.push({ kind: "WrongSize", required: size, count: total });

  const commanderCards = commanders.map((commander) => rules(commander.oracleId));
  for (const name of invalidCommanders(commanderCards)) {
    problems.push({ kind: "CommanderInvalid", name });
  }
  // Two copies of one card are a singleton problem, not a pairing one.
  if (commanderCount === 2 && commanderCards.length === 2) {
    const pairing = pairProblem(commanderCards);
    if (pairing !== null) problems.push(pairing);
  }
  const identity = new Set<string>(commanderCards.flatMap((card) => card.colorIdentity));
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
export function deckProblems(
  deck: DeckToCheck,
  rules: RulesLookup,
  owned: OwnedLookup,
): DeckProblem[] {
  // The maybeboard is counted nowhere (design doc 32, invariant 1).
  const counted = { ...deck, entries: deck.entries.filter((entry) => isCounted(entry.board)) };
  return countedCardProblems(counted, rules, owned);
}

/** The problems of a deck's counted boards. */
function countedCardProblems(
  deck: DeckToCheck,
  rules: RulesLookup,
  owned: OwnedLookup,
): DeckProblem[] {
  const copies = copiesByCard(deck.entries);
  const problems = ownershipProblems(copies, rules, owned);
  const format = FORMAT_RULES[deck.format];

  switch (format.kind) {
    case "casual":
      return problems;
    case "constructed": {
      const main = count(deck.entries.filter((entry) => isPlayed(entry.board)));
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
    case "limited": {
      // Conspiracies start the game in the command zone, not the deck (CR 905.4).
      const main = count(
        deck.entries.filter(
          (entry) =>
            isPlayed(entry.board) && !/\bConspiracy\b/.test(rules(entry.oracleId).typeLine),
        ),
      );
      if (main < format.minimum)
        problems.push({ kind: "TooFewCards", minimum: format.minimum, count: main });
      return problems;
    }
    case "commander":
      problems.push(...commanderProblems(deck, rules, format.size));
      problems.push(...copyLimitProblems(copies, rules, 1));
      problems.push(...legalityProblems(deck.format, copies, rules));
      return problems;
  }
}

export const CONSTRUCTED_60_FORMATS = [
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
  "pauper",
] as const satisfies readonly Format[];

export type FormatRulesSummary = Readonly<{
  minMainCards: number;
  exactSize: boolean;
  maxCopies: number | null;
  maxSideboard: number | null;
}>;

/** Size, copy-limit, and sideboard constraints for a format (null when unconstrained). */
export function formatRulesSummary(format: string): FormatRulesSummary {
  const rules = format in FORMAT_RULES ? FORMAT_RULES[format as Format] : FORMAT_RULES.casual;
  switch (rules.kind) {
    case "casual":
      return { minMainCards: 60, exactSize: false, maxCopies: null, maxSideboard: null };
    case "constructed":
      return {
        minMainCards: rules.minimum,
        exactSize: false,
        maxCopies: rules.copies,
        maxSideboard: rules.sideboard,
      };
    case "commander":
      return { minMainCards: rules.size, exactSize: true, maxCopies: 1, maxSideboard: null };
    case "limited":
      return { minMainCards: rules.minimum, exactSize: false, maxCopies: null, maxSideboard: null };
  }
}

/**
 * Maximum total copies (main + side) allowed for a card in `format`, or `null` when unlimited
 * (basic lands, "any number of cards named", Casual, Limited). Restricted cards return `1`.
 */
export function copyLimitFor(
  format: string,
  card?: Pick<CardRules, "isBasicLand" | "text" | "legalities">,
): number | null {
  if (card !== undefined && isUnlimited(card)) return null;
  const maxCopies = formatRulesSummary(format).maxCopies;
  if (maxCopies === null) return null;
  if (card !== undefined && card.legalities[format] === "restricted") return 1;
  return maxCopies;
}

/**
 * All 60-card constructed formats (`CONSTRUCTED_60_FORMATS`) in which the deck's current counted
 * cards pass card legality and copy-limit rules (irrespective of unfinished main-deck size).
 */
export function legalFormatsForCards(deck: DeckToCheck, rules: RulesLookup): Format[] {
  const counted = deck.entries.filter((entry) => isCounted(entry.board));
  const copies = copiesByCard(counted);
  return CONSTRUCTED_60_FORMATS.filter(
    (format) =>
      legalityProblems(format, copies, rules).length === 0 &&
      copyLimitProblems(copies, rules, 4).length === 0,
  );
}

/** How many cards short a deck is, in total (for the "short 3" badge). */
export function shortCount(problems: readonly DeckProblem[]): number {
  return problems.reduce(
    (total, problem) => total + (problem.kind === "Short" ? problem.needed - problem.owned : 0),
    0,
  );
}
