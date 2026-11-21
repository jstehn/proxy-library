import type { DbExecutor } from "@/shared/db";
import { seededRng, type Rng, type UserId } from "@/shared/kernel";
import { isPlayed } from "../domain/boards";
import type { Deck } from "../domain/deck";
import {
  optimizeDeck,
  type OptimizerCard,
  type OptimizeResult,
} from "@/modules/decks/scoring/client";
import type { DeckLine } from "../domain/deck-view";
import { deckView } from "./decks";
import { deckSuggestions } from "./suggestions";
import { type Suggestion } from "../domain/suggestion-types";

export type OptimizeDeckPool = "owned" | "store" | "both";

export type OptimizeDeckQueryOptions = Readonly<{
  pool?: OptimizeDeckPool;
  maxSwaps?: number;
  iterations?: number;
  maxAddedPriceCents?: number | null;
  lockedOracleIds?: ReadonlySet<string>;
  seed?: string;
  rng?: Rng;
}>;

export type OptimizeDeckViewResult = Readonly<{
  deck: Deck;
  result: OptimizeResult;
}>;

export function lineToOptimizerCard(line: DeckLine): OptimizerCard {
  return {
    oracleId: line.oracleId,
    name: line.name,
    typeLine: line.typeLine,
    manaValue: line.manaValue,
    manaCost: line.manaCost,
    text: line.text,
    producedMana: line.producedMana,
    keywords: line.keywords,
    roles: line.roles,
    themes: line.themes,
    signals: line.signals,
    leaderThemes: line.leaderThemes,
    rarity: line.rarity,
    priceCents: line.priceCents,
    isGameChanger: line.isGameChanger,
    bracketFlags: line.bracketFlags,
    edhrec: line.edhrec,
    edhrecRank: line.edhrecRank,
    board: line.board,
    quantity: line.quantity,
  };
}

export function suggestionToOptimizerCard(s: Suggestion): OptimizerCard {
  const c = s.card;
  return {
    oracleId: c.oracleId,
    name: c.name,
    typeLine: c.typeLine,
    manaValue: c.manaValue,
    manaCost: null,
    text: c.text,
    producedMana: [],
    keywords: c.keywords,
    roles: c.roles,
    themes: c.themes,
    signals: c.signals,
    rarity: c.rarity,
    priceCents: c.priceCents,
    isGameChanger: c.isGameChanger,
    bracketFlags: c.bracketFlags,
    edhrec: c.edhrec,
    edhrecRank: c.edhrecRank,
    embedSim: c.embedSim,
    pool: c.pool,
    board: "main",
    quantity: 1,
  };
}

/**
 * Runs the Simulated Annealing whole-deck optimizer on a player's deck
 * using candidates from `deckSuggestions` (owned, store, or both).
 */
export async function optimizeDeckForView(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
  options: OptimizeDeckQueryOptions = {},
): Promise<OptimizeDeckViewResult | null> {
  const [view, suggestions] = await Promise.all([
    deckView(db, userId, deckId),
    deckSuggestions(db, userId, deckId),
  ]);
  if (view === null) return null;

  const currentDeck = view.lines.filter((line) => isPlayed(line.board)).map(lineToOptimizerCard);

  const poolMode = options.pool ?? "owned";
  const rawPool: Suggestion[] =
    poolMode === "both"
      ? [...(suggestions?.forDeck.owned ?? []), ...(suggestions?.forDeck.store ?? [])]
      : [...(suggestions?.forDeck[poolMode] ?? [])];

  const candidatePool = rawPool.map(suggestionToOptimizerCard);
  const rng = options.rng ?? seededRng(options.seed ?? `deck-${deckId}`);

  const result = optimizeDeck(currentDeck, candidatePool, {
    format: view.deck.format,
    targetBracket: view.deck.targetBracket,
    maxSwaps: options.maxSwaps,
    iterations: options.iterations,
    maxAddedPriceCents: options.maxAddedPriceCents,
    lockedOracleIds: options.lockedOracleIds,
    rng,
  });

  return { deck: view.deck, result };
}
