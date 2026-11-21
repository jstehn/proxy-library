import { type Tag, type Theme } from "@/shared/kernel";
import type { ManaColor, CardFacts, CardIdentity } from "@/shared/kernel";
import {
  bracketLine,
  fitsTarget,
  type Bracket,
  type BracketLine,
  type DeckPlan,
  type Format,
} from "@/modules/decks/core/client";
import type { CardRating } from "@/modules/decks/scoring/client";
import type { EdhrecSignal, ProfileLine } from "@/modules/decks/core/client";
import { type Scored } from "@/modules/decks/scoring/client";
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

/** A pool split into the cards that keep the deck within its target and those that don't. */
type TargetSplit = Readonly<{ kept: SuggestionCard[]; over: SuggestionCard[] }>;

/** Leaves out cards that would take the deck over its target bracket (invariant 10). */
export function withinTarget(
  cards: readonly SuggestionCard[],
  context: SuggestionContext,
): TargetSplit {
  const target = context.targetBracket;
  if (target === null) return { kept: [...cards], over: [] };
  const kept: SuggestionCard[] = [];
  const over: SuggestionCard[] = [];
  for (const card of cards) {
    const flags = bracketLine({ ...card, quantity: 1, board: "main" }).flags;
    (fitsTarget(context.bracketLines, { name: card.name, flags }, target) ? kept : over).push(card);
  }
  return { kept, over };
}

/** The cards a suggestion can pick from, for one player. SQL in `queries/suggestion-pool.ts`. */
export interface CandidatePool {
  /** The deck as the suggestions read it, or null if it isn't this player's. */
  context(deckId: number): Promise<SuggestionContext | null>;
  /** Cards that combine with the deck's cards: candidate oracle id to partner names. */
  comboPartners(
    playedOracleIds: readonly string[],
    targetBracket: Bracket | null,
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  /** Cards you own that share something with what's wanted, one per oracle card. */
  owned(
    context: SuggestionContext,
    want: Wanted,
    comboPartnerIds?: readonly string[],
  ): Promise<SuggestionCard[]>;
  /** The cheapest printing for sale of each card that shares something with what's wanted. */
  store(
    context: SuggestionContext,
    want: Wanted,
    comboPartnerIds?: readonly string[],
  ): Promise<SuggestionCard[]>;
  /** Owned cards among these oracle ids (optionally at most this price). */
  ownedAmong(
    context: SuggestionContext,
    oracleIds: readonly string[],
    maxPriceCents?: number,
  ): Promise<SuggestionCard[]>;
  /** The cheapest printings for sale among these oracle ids (optionally at most this price). */
  storeAmong(
    context: SuggestionContext,
    oracleIds: readonly string[],
    maxPriceCents?: number,
  ): Promise<SuggestionCard[]>;
  /** How alike each candidate is to the deck's cards, by text embedding (empty without any). */
  similarities(
    deckOracleIds: readonly string[],
    candidateOracleIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
  /** The cards nearest this one by text embedding, nearest first. */
  neighbours(
    oracleId: string,
    limit: number,
  ): Promise<ReadonlyArray<Readonly<{ oracleId: string; similarity: number }>>>;
  /** One card as a suggestion card (its standard printing), or null if the catalog lacks it. */
  cardLike(oracleId: string, context: SuggestionContext): Promise<SuggestionCard | null>;
  /** The deck's plan (key and avoided cards) and the cards the player pinned. */
  deckPlan(
    deckId: number,
  ): Promise<Readonly<{ plan: DeckPlan | null; pinnedOracleIds: ReadonlySet<string> }>>;
  /** Each card's name, type line and cheapest price (null when it has none). */
  cheapestPrices(
    oracleIds: readonly string[],
  ): Promise<
    ReadonlyArray<
      Readonly<{ oracleId: string; name: string; typeLine: string; priceCents: number | null }>
    >
  >;
}
