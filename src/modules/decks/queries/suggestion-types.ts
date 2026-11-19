import { z } from "zod";
import { type Tag, type Theme } from "@/shared/card-search";
import { ColorSchema } from "@/shared/kernel";
import { type Bracket, type BracketLine } from "../domain/brackets";
import { type Format } from "../domain/deck";
import type { RatingPart } from "../domain/rate";
import { type EdhrecSignal, type ProfileLine, type Scored } from "../domain/suggest";
import type { BrowseCard } from "./browse";

// The shapes of deck suggestions (design doc 20, section 9).

/** A suggested card: everything the builder's grid shows (so it can be selected and added). */
export type SuggestionCard = BrowseCard &
  Readonly<{
    pool: "owned" | "store";
    keywords: string[];
    roles: Tag[];
    themes: Theme[];
    rarity: string;
    edhrecRank?: number | null;
    edhrec?: EdhrecSignal | null;
    embedSim?: number | null;
  }>;

export type Suggestion = Readonly<{
  card: SuggestionCard;
  reasons: Scored["reasons"];
  rating: number;
  ratingParts: readonly RatingPart[];
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
  colorLimit: Array<z.infer<typeof ColorSchema>> | null;
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
