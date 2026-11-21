import { type Tag, type Theme } from "@/shared/kernel";
import type { ManaColor, CardFacts, CardIdentity } from "@/shared/kernel";
import { type Bracket, type BracketLine } from "./brackets";
import { type Format } from "./deck";
import type { CardRating } from "./rate";
import type { EdhrecSignal, ProfileLine } from "./stats";
import { type Scored } from "./suggest";
import type { BrowseCard } from "./browse-card";

// The shapes of deck suggestions (design doc 20, section 9).

/** A suggested card: everything the builder's grid shows (so it can be selected and added). */
export type SuggestionCard = BrowseCard &
  Readonly<{
    pool: "owned" | "store";
    keywords: string[];
    rarity: string;
    edhrecRank?: number | null;
    edhrec?: EdhrecSignal | null;
    embedSim?: number | null;
  }>;

export type Suggestion = Readonly<{
  card: SuggestionCard;
  reasons: Scored["reasons"];
  rating: CardRating;
}>;

/** One list of suggestions: cards you own first, then cards in the store. */
export type SuggestionList = Readonly<{
  owned: Suggestion[];
  store: Suggestion[];
  /** Cards that would have been suggested but go over the deck's target bracket (design doc 31). */
  hiddenOverTarget: number;
}>;

export const EMPTY_LIST: SuggestionList = { owned: [], store: [], hiddenOverTarget: 0 };

/** What the queries need to know about a deck. */
export type SuggestionContext = Readonly<{
  deckId: number;
  format: Format;
  /** Whether real copies count as owned here (design doc 16). */
  usesRealCards: boolean;
  /** Colors a suggestion's identity must stay within, or null for any. */
  colorLimit: ManaColor[] | null;
  /** Oracle cards already at their format copy limit, not suggested again. */
  inDeck: string[];
  /** Counted quantity per oracle id currently in this deck (main + side + commander). */
  countedQuantities: ReadonlyMap<string, number>;
  /** The deck's lines, with their cards' oracle ids. */
  lines: Array<ProfileLine & Readonly<{ oracleId: string }>>;
  /** Oracle ids of the deck's commanders (Commander format only; empty otherwise). */
  commanderOracleIds: string[];
  /** The bracket the owner chose (Commander only), and the deck as the estimate reads it. */
  targetBracket: Bracket | null;
  bracketLines: BracketLine[];
}>;

/** What a candidate must share with the deck (any one of these). */
export type Wanted = Readonly<{
  roles: readonly Tag[];
  themes: readonly Theme[];
  tribes: readonly string[];
  keywords: readonly string[];
}>;

export type BudgetReplacementPick = Readonly<{
  card: SuggestionCard;
  savedCents: number;
  matchedRoles: readonly Tag[];
}>;

export type ExpensiveCardReplacements = Readonly<{
  target: Pick<CardIdentity, "oracleId"> &
    Pick<CardFacts, "name" | "typeLine"> &
    Readonly<{ priceCents: number }>;
  owned: BudgetReplacementPick[];
  store: BudgetReplacementPick[];
}>;

export type BudgetReplacementsResult = Readonly<{
  cards: ExpensiveCardReplacements[];
  minPriceCents: number;
  maxPriceCents: number;
}>;
