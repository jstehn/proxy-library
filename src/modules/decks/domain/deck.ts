import type { Finish, PrintingId } from "@/modules/catalog";
import { err, ok, type Brand, type Result, type UserId } from "@/shared/kernel";
import type {
  CommanderMove,
  EntryNotFound,
  FinishNotAvailable,
  NameInvalid,
  PrintingNotOfCard,
  QuantityInvalid,
  TargetBracketInvalid,
  TargetBracketNotCommander,
} from "./errors";
import { isBracket, type Bracket } from "./brackets";

// The deck builder's vocabulary (design doc 09, section 3).

export type DeckId = Brand<number, "DeckId">;
export const DeckId = {
  of(raw: number): DeckId {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new RangeError(`not a deck id: ${raw}`);
    return raw as DeckId;
  },
};

export {
  BOARDS,
  COUNTED_BOARDS,
  isCounted,
  isPlayed,
  type Board,
  type CountedBoard,
} from "./boards";
import type { Board } from "./boards";

export const FORMATS = [
  "casual",
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
  "pauper",
  "commander",
  "limited",
] as const;
export type Format = (typeof FORMATS)[number];

/** Where a deck came from, when the app made it for the player: a finished draft (design doc 17). */
export type DeckOrigin = Readonly<{ kind: "draft"; draftId: number }>;

export const DeckOrigin = {
  /** Stored as text, like a ledger entry's ref: "draft:12". */
  toText(origin: DeckOrigin): string {
    return `${origin.kind}:${origin.draftId}`;
  },
  parse(text: string | null): DeckOrigin | null {
    const match = text === null ? null : /^draft:(\d+)$/.exec(text);
    return match === null ? null : { kind: "draft", draftId: Number(match[1]) };
  },
};

/** A line in a deck: a card (any printing), where it goes, how many, and which version to show. */
export type DeckEntry = Readonly<{
  oracleId: string;
  board: Board;
  quantity: number;
  printingId: PrintingId | null;
  finish: Finish | null;
  /** The deck's own heading for this line ("Ramp"), or null (design doc 34). */
  heading: string | null;
  /** Why this card is in the deck (design doc 41), or null. */
  note: string | null;
}>;

export const GROUPINGS = ["type", "custom"] as const;
/** How the main deck is grouped: by card type (the default) or by its own headings. */
export type Grouping = (typeof GROUPINGS)[number];

export type Deck = Readonly<{
  id: DeckId;
  ownerId: UserId;
  name: string;
  format: Format;
  /** "Use my real cards" (design doc 16, rule 2): real copies count as owned in this deck. */
  usesRealCards: boolean;
  /** The Commander bracket the owner means it for (design doc 31). Commander only; null: none. */
  targetBracket: Bracket | null;
  grouping: Grouping;
  /** The deck's headings in the owner's order; `tidyHeadings` keeps it matching the lines. */
  headings: readonly string[];
  entries: readonly DeckEntry[];
}>;

export const MAX_DECKS = 100;
export const MAX_NAME_LENGTH = 60;
export const MAX_QUANTITY = 99;

export function checkName(raw: string): Result<string, NameInvalid> {
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return err({ kind: "NameInvalid", maximum: MAX_NAME_LENGTH });
  }
  return ok(name);
}

/** A target bracket for a deck of this format: 1–5 on Commander decks, or null (design doc 31). */
export function checkTargetBracket(
  format: Format,
  target: number | null,
): Result<Bracket | null, TargetBracketInvalid | TargetBracketNotCommander> {
  if (target === null) return ok(null);
  if (!isBracket(target)) return err({ kind: "TargetBracketInvalid" });
  if (format !== "commander") return err({ kind: "TargetBracketNotCommander" });
  return ok(target);
}

/** 0 removes the entry; otherwise 1–99 (rule 6). */
export function checkQuantity(quantity: number): Result<number, QuantityInvalid> {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
    return err({ kind: "QuantityInvalid", maximum: MAX_QUANTITY });
  }
  return ok(quantity);
}

/**
 * The deck with one entry set to a quantity (0 removes it). Keeps the entry's pinned printing
 * unless a new one is given.
 */
export function withEntry(
  deck: Deck,
  change: Omit<DeckEntry, "printingId" | "finish" | "heading" | "note"> & {
    printingId?: PrintingId | null;
    finish?: Finish | null;
    /** A heading, null to clear it, or left out to keep the line's (design doc 34). */
    heading?: string | null;
    /** A note, null to clear it, or left out to keep the line's (design doc 41). */
    note?: string | null;
  },
): Deck {
  const same = (entry: DeckEntry) =>
    entry.oracleId === change.oracleId && entry.board === change.board;
  const existing = deck.entries.find(same);
  const others = deck.entries.filter((entry) => !same(entry));
  if (change.quantity === 0) return { ...deck, entries: others };
  const entry: DeckEntry = {
    oracleId: change.oracleId,
    board: change.board,
    quantity: change.quantity,
    printingId: change.printingId ?? existing?.printingId ?? null,
    finish: change.finish ?? existing?.finish ?? null,
    heading: change.heading !== undefined ? change.heading : (existing?.heading ?? null),
    note: change.note !== undefined ? change.note : (existing?.note ?? null),
  };
  return { ...deck, entries: [...others, entry] };
}

/** Moving a card's line to another board (design doc 32): to the maybeboard and back. */
export type EntryMove = Readonly<{ oracleId: string; from: Board; to: Board }>;

/**
 * The deck with one card's line moved to another board. If the card is on that board already,
 * the copies add up (at most 99), and the moved line's pinned printing wins when it has one.
 * Commanders don't move: choosing one is its own step.
 */
export function movedEntry(
  deck: Deck,
  move: EntryMove,
): Result<Deck, EntryNotFound | CommanderMove> {
  if (move.from === "commander" || move.to === "commander") return err({ kind: "CommanderMove" });
  const moving = deck.entries.find(
    (entry) => entry.oracleId === move.oracleId && entry.board === move.from,
  );
  if (moving === undefined) return err({ kind: "EntryNotFound" });
  if (move.from === move.to) return ok(deck);

  const there = deck.entries.find(
    (entry) => entry.oracleId === move.oracleId && entry.board === move.to,
  );
  const withoutOld = withEntry(deck, { oracleId: move.oracleId, board: move.from, quantity: 0 });
  return ok(
    withEntry(withoutOld, {
      oracleId: move.oracleId,
      board: move.to,
      quantity: Math.min(MAX_QUANTITY, moving.quantity + (there?.quantity ?? 0)),
      printingId: moving.printingId ?? there?.printingId ?? null,
      finish: moving.printingId === null ? (there?.finish ?? null) : moving.finish,
      heading: moving.heading ?? there?.heading ?? null,
      note: moving.note ?? there?.note ?? null,
    }),
  );
}

/** A printing chosen for a deck line, and what the catalog says about it (design doc 24). */
export type PrintingChoice = Readonly<{
  oracleId: string;
  board: Board;
  /** The printing to pin, or null to follow your copies again (rule 4). */
  pinned: Readonly<{
    printingId: PrintingId;
    finish: Finish;
    /** The catalog's facts about that printing, or null if it isn't in the catalog. */
    facts: PrintingFacts | null;
  }> | null;
}>;

export type PrintingFacts = Readonly<{ oracleId: string; finishes: readonly Finish[] }>;

export type ChoosePrintingError = EntryNotFound | PrintingNotOfCard | FinishNotAvailable;

/**
 * Pins one line to a printing and finish, or unpins it. The quantity never changes
 * (design doc 24, rules 3 and 4).
 */
export function withPrinting(
  deck: Deck,
  choice: PrintingChoice,
): Result<Deck, ChoosePrintingError> {
  const existing = deck.entries.find(
    (entry) => entry.oracleId === choice.oracleId && entry.board === choice.board,
  );
  if (existing === undefined) return err({ kind: "EntryNotFound" });

  const { pinned } = choice;
  if (pinned !== null) {
    if (pinned.facts === null || pinned.facts.oracleId !== choice.oracleId)
      return err({ kind: "PrintingNotOfCard" });
    if (!pinned.facts.finishes.includes(pinned.finish)) return err({ kind: "FinishNotAvailable" });
  }

  const changed: DeckEntry = {
    ...existing,
    printingId: pinned?.printingId ?? null,
    finish: pinned?.finish ?? null,
  };
  return ok({
    ...deck,
    entries: deck.entries.map((entry) => (entry === existing ? changed : entry)),
  });
}

/** The most lines one list save may have (design doc 23, rule 8). */
export const MAX_LIST_LINES = 1000;

/** One line of a saved list, matched to a card by the catalog (design doc 23). */
export type MatchedLine = Readonly<{
  oracleId: string;
  board: Board;
  quantity: number;
  /** The printing and finish the catalog chose: the named one, or your most special copy. */
  printingId: PrintingId;
  finish: Finish;
  /** True when the line said which printing: "1 Sol Ring (C21) 263". */
  namesPrinting: boolean;
  /** "*F*" or "*E*" on the line, which always wins. */
  finishMarker: Finish | null;
  /** The heading the line was under in the text ("Ramp (9)"), or null (design doc 34). */
  heading: string | null;
}>;

/**
 * The entries a deck holds after replacing its list with `lines` (design doc 23, rules 2-4). Two
 * lines for the same card on the same board are added together (at most 99). A card the deck
 * already has keeps its printing and finish unless the line names a different printing; a
 * finish marker always wins. A new card takes the printing and finish the catalog chose.
 *
 * Headings (design doc 34): text with any heading in it sets every main-deck line's heading;
 * text without one keeps the headings the deck's cards already have. Other boards always keep
 * theirs, since text shows headings on the main deck only (a card on the maybeboard keeps its
 * heading for when it comes back).
 */
export function replacedEntries(
  current: readonly DeckEntry[],
  lines: readonly MatchedLine[],
): DeckEntry[] {
  const textHasHeadings = lines.some((line) => line.heading !== null);
  // A Map keeps insertion order, so the entries come out in the order of the text.
  const entries = new Map<string, DeckEntry>();
  for (const line of lines) {
    const key = `${line.board}:${line.oracleId}`;
    const already = entries.get(key);
    if (already !== undefined) {
      entries.set(key, {
        ...already,
        quantity: Math.min(MAX_QUANTITY, already.quantity + line.quantity),
      });
      continue;
    }
    const version = chosenVersion(current, line);
    entries.set(key, {
      ...version,
      quantity: Math.min(MAX_QUANTITY, line.quantity),
      heading: textHasHeadings && line.board === "main" ? line.heading : version.heading,
    });
  }
  return [...entries.values()];
}

/** Which printing and finish one new list line gets (the rules above `replacedEntries`). */
function chosenVersion(current: readonly DeckEntry[], line: MatchedLine): DeckEntry {
  // The same card on the same board first, then the same card on any board.
  const existing =
    current.find((entry) => entry.oracleId === line.oracleId && entry.board === line.board) ??
    current.find((entry) => entry.oracleId === line.oracleId);
  const base = {
    oracleId: line.oracleId,
    board: line.board,
    quantity: line.quantity,
    heading: existing?.heading ?? null,
    note: existing?.note ?? null,
  };

  if (existing !== undefined && (!line.namesPrinting || existing.printingId === line.printingId)) {
    return {
      ...base,
      printingId: existing.printingId,
      finish: line.finishMarker ?? existing.finish,
    };
  }
  return { ...base, printingId: line.printingId, finish: line.finishMarker ?? line.finish };
}

/**
 * Which deck lists become decks in your deck list when you open them (feedback 2026-09-27: "buy a
 * precon and have it in my decks"). Precons, starter and welcome decks do; a bundle's land pack
 * isn't a deck.
 */
export function becomesADeck(deckType: string): boolean {
  return !/land pack/i.test(deckType);
}
