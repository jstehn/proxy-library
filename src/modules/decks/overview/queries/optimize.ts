import type { DbExecutor } from "@/shared/db";
import { seededRng, type Rng, type UserId } from "@/shared/kernel";
import { isPlayed } from "@/modules/decks/core/client";
import type { Deck } from "@/modules/decks/core/client";
import {
  optimizeDeck,
  type OptimizerCard,
  type OptimizeResult,
  lineToOptimizerCard,
} from "@/modules/decks/scoring/client";
import { deckView } from "@/modules/decks/core";
import { candidatePool, deckSuggestions, type Suggestion } from "@/modules/decks/building";

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
    deckSuggestions(candidatePool(db, userId), deckId),
  ]);
  if (view === null) return null;

  const currentDeck = view.lines.filter((line) => isPlayed(line.board)).map(lineToOptimizerCard);

  const poolMode = options.pool ?? "owned";
  const rawPool: Suggestion[] =
    poolMode === "both"
      ? [...(suggestions?.forDeck.owned ?? []), ...(suggestions?.forDeck.store ?? [])]
      : [...(suggestions?.forDeck[poolMode] ?? [])];

  const optimizerCandidates = rawPool.map(suggestionToOptimizerCard);
  const rng = options.rng ?? seededRng(options.seed ?? `deck-${deckId}`);

  const result = optimizeDeck(currentDeck, optimizerCandidates, {
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
