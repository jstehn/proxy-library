import type { BracketFlag } from "@/shared/kernel";
import type { Finish, CardFacts, CardIdentity, SignalIO, Tag, Theme } from "@/shared/kernel";
import type { DeckCount } from "./boards";
import type { Deck, Format } from "./deck";
import type { DeckPlan } from "./deck-profile";
import {
  bracketLine,
  bracketRuleReasons,
  bracketWarning,
  estimateBracket,
  type Bracket,
  type BracketEstimate,
  type BracketRuleReason,
  type BracketWarning,
  type DeckCombo,
} from "./brackets";
import { deckText, fingerprint } from "./list-format";
import { deckProblems, type CardRules, type DeckProblem } from "./rules";
import type { EdhrecSignal } from "./stats";

// The deck as the builder, the tools and the audits read it (design doc 09, section 8). The query
// that loads it is `queries/decks.ts`; the types live here so the application layer can name them.

/** One deck line with everything the builder shows. */
export type DeckLine = DeckCount &
  CardIdentity &
  Pick<CardFacts, "name" | "typeLine" | "manaValue" | "manaCost" | "text"> &
  Readonly<{
    finish: Finish;
    /** What the deck stores (null when not pinned): for Edit as text (design doc 23). */
    pinnedPrintingId: string | null;
    pinnedFinish: Finish | null;
    /** The deck's own heading for this line ("Ramp"), or null (design doc 34). */
    heading: string | null;
    /** Why this card is in the deck (design doc 41), or null. */
    note: string | null;
    /** Structured role/synergy tags on this line. */
    tags?: readonly string[];
    /** The card's one-line job in this deck, or null (design doc 61). */
    role?: string | null;
    /** Pinned: tools never suggest cutting or replacing it (design doc 61). */
    pinned?: boolean;
    /** Colors of mana it can make, for the deck statistics. */
    producedMana: string[];
    /** What job the card does in a deck (the catalog's card features). */
    roles: readonly Tag[];
    /** What deck the card plays into, and what deck it leads as a commander (card features). */
    themes: readonly Theme[];
    leaderThemes: readonly Theme[];
    /** Rules text face by face (front first), for showing double-faced cards as "front // back". */
    faceTexts?: readonly string[];
    /** The front face's printed stats: "6/5", "Loyalty 4" or "Defense 5"; null when it has none. */
    printedStats?: string | null;
    /** On Wizards' Game Changer list (design doc 31). */
    isGameChanger: boolean;
    /** Why it may count against a bracket: Game Changer, land denial, extra turns (design doc 31). */
    bracketFlags: readonly BracketFlag[];
    /** The themes it makes and uses (card features). */
    signals: SignalIO;
    /** Latest market price of one copy in its finish, in cents, if known. */
    priceCents: number | null;
    setCode: string;
    collectorNumber: string;
    /** The shown printing's rarity, for the cut ranking's tie-break (design doc 32). */
    rarity: string;
    /** Keyword abilities on any printing of the card ("Flying", "Ward"). */
    keywords: string[];
    /** Scryfall's EDHREC popularity rank (1 = most popular), or null if unranked. */
    edhrecRank: number | null;
    /** Copies counted as owned: game copies, plus real ones when the deck uses them. */
    owned: number;
    /** How many of `owned` are real copies (design doc 16: "3 game · 1 real"). */
    ownedReal: number;
    isBasicLand: boolean;
    /**
     * Your other decks that also use this card, and how many copies each holds (ownership is
     * shared between decks, so they can all count the same copies).
     */
    otherDecks: OtherDeckUse[];
    /** Copies owned that none of your other decks uses (task 42): `owned` minus theirs, at least 0. */
    free: number;
    /** EDHREC inclusion rate and synergy for this deck's commander(s), when synced. */
    edhrec?: EdhrecSignal | null;
  }>;

/** Another of your decks holding a card, on any board (task 42). */
export type OtherDeckUse = Readonly<{
  deckId: number;
  name: string;
  /** Copies of the card in that deck, on every board. */
  quantity: number;
  /** How many of them it can give: all but its commanders, which are never taken. */
  available: number;
}>;

export type DeckView = Readonly<{
  deck: Deck;
  lines: DeckLine[];
  rules: Readonly<Record<string, CardRules>>;
}>;

export type DeckSource = Readonly<{
  id: number;
  url: string;
  title: string;
  usedFor: string;
  addedAt: string;
}>;

/** A deck's stored profile and primer (design doc 61). */
export type StoredDeckProfile = Readonly<{
  deckId: number;
  deckName: string;
  format: string;
  profile: DeckPlan;
  primer: string | null;
}>;

// The facts about a deck that every reader needs the same way (design doc 65, audit F2): its
// problems, its Commander bracket, and its list text with the fingerprint of what's stored. The
// builder, the deck page and the LLM tools all take these from here.

/**
 * Everything wrong with the deck made of `lines`. A line whose rules haven't arrived can't be
 * checked yet, so it's left out (the builder shows a card before the server has answered).
 */
export function problemsOfLines(
  format: Format,
  lines: readonly DeckLine[],
  rules: Readonly<Record<string, CardRules>>,
): DeckProblem[] {
  const checkable = lines.filter((line) => rules[line.oracleId] !== undefined);
  const owned = new Map(checkable.map((line) => [line.oracleId, line.owned]));
  return deckProblems(
    {
      format,
      entries: checkable.map((line) => ({
        oracleId: line.oracleId,
        board: line.board,
        quantity: line.quantity,
        printingId: null,
        finish: null,
        heading: null,
        note: null,
      })),
    },
    (oracleId) => rules[oracleId],
    (oracleId) => owned.get(oracleId) ?? 0,
  );
}

export type BracketReport = Readonly<{
  target: Bracket | null;
  estimate: BracketEstimate;
  /** Set when the deck's floor is above its target. */
  warning: BracketWarning | null;
  /** One entry per `estimate.findings`, with the threshold that triggered it. */
  reasons: readonly BracketRuleReason[];
}>;

/** The Commander bracket estimate and what it says about the target; null outside Commander. */
export function bracketReport(view: DeckView, combos?: readonly DeckCombo[]): BracketReport | null {
  const estimate = estimateBracket(view.deck.format, view.lines.map(bracketLine), { combos });
  if (estimate === null) return null;
  return {
    target: view.deck.targetBracket,
    estimate,
    warning: bracketWarning(estimate, view.deck.targetBracket),
    reasons: bracketRuleReasons(estimate.findings),
  };
}

/** The deck as its list text and the fingerprint of what's stored (for editing it as text). */
export function listAndFingerprint(view: DeckView): { list: string; fingerprint: string } {
  const list = deckText(
    view.lines.map((line) => ({
      quantity: line.quantity,
      name: line.name,
      board: line.board,
      setCode: line.pinnedPrintingId === null ? null : line.setCode,
      collectorNumber: line.pinnedPrintingId === null ? null : line.collectorNumber,
      finish: line.pinnedFinish,
      heading: line.heading,
    })),
    // Grouped by its own headings, the list shows them as "Ramp (9)" blocks (design doc 34).
    view.deck.grouping === "custom" ? view.deck.headings : null,
  );
  const print = fingerprint(
    view.lines.map((line) => ({
      ...line,
      printingId: line.pinnedPrintingId,
      finish: line.pinnedFinish,
    })),
  );
  return { list, fingerprint: print };
}
