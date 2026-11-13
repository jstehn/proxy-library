import { randomInt, type Rng } from "@/shared/kernel";
import { type Tag, type Theme } from "@/shared/card-search";
import { bracketLine, estimateBracket, type Bracket } from "./brackets";
import type { Format } from "./deck";
import { rateCard, type RatingEdhrecSignal, type RatingProfile } from "./rate";
import { cardSignalIO, deckSignalProfile, synergyMatches } from "./signals";
import {
  deckStats,
  isLand,
  MANA_COLORS,
  roleTargets,
  type StatsLine,
  type TargetedTag,
} from "./stats";
import { deckProfile } from "./suggest";

// Whole-deck objective and Simulated Annealing optimizer (design doc 55):
// scores a complete decklist across card quality, role coverage, curve, color balance,
// synergy cohesion, bracket compliance, and budget, then searches multi-card swaps with Rng.

export type OptimizerCard = StatsLine &
  Readonly<{
    oracleId: string;
    name: string;
    keywords: readonly string[];
    roles: readonly Tag[];
    themes: readonly Theme[];
    rarity: string;
    isGameChanger?: boolean;
    edhrec?: RatingEdhrecSignal | null;
    edhrecRank?: number | null;
    preconCount?: number | null;
    comboPartners?: readonly string[] | null;
    embedSim?: number | null;
    pool?: "owned" | "store";
  }>;

export type ScoreDeckContext = Readonly<{
  format: Format;
  targetBracket?: Bracket | null;
  maxAddedPriceCents?: number | null;
  addedPriceCents?: number;
  pairSimilarity?: (aOracleId: string, bOracleId: string) => number | null;
}>;

export type DeckScoreMetrics = Readonly<{
  averageManaValue: number;
  rampCount: number;
  drawCount: number;
  removalCount: number;
  wipeCount: number;
  cardQualityMean: number;
  gameChangerCount: number;
  addedPriceCents: number;
}>;

export type DeckScore = Readonly<{
  total: number;
  cardQuality: number;
  roleCoverage: number;
  curveScore: number;
  colorBalance: number;
  synergyCohesion: number;
  bracketPenalty: number;
  budgetPenalty: number;
  metrics: DeckScoreMetrics;
}>;

export type OptimizeOptions = Readonly<{
  format: Format;
  targetBracket?: Bracket | null;
  maxSwaps?: number;
  iterations?: number;
  initialTemp?: number;
  coolingRate?: number;
  maxAddedPriceCents?: number | null;
  rng: Rng;
  pairSimilarity?: (aOracleId: string, bOracleId: string) => number | null;
  lockedOracleIds?: ReadonlySet<string>;
}>;

export type OptimizedSwap = Readonly<{
  cut: OptimizerCard;
  add: OptimizerCard;
  netCardRatingGain: number;
  priceCents: number | null;
}>;

export type OptimizeResult = Readonly<{
  before: DeckScore;
  after: DeckScore;
  delta: number;
  swaps: readonly OptimizedSwap[];
  iterationsRun: number;
  acceptedMoves: number;
  improvedMoves: number;
}>;

const OBJECTIVE_WEIGHTS = {
  cardQuality: 0.45,
  roleCoverage: 0.25,
  curveScore: 0.15,
  colorBalance: 0.05,
  synergyCohesion: 0.1,
} as const;

const ROLE_WEIGHTS: Readonly<Record<TargetedTag, number>> = {
  ramp: 0.3,
  draw: 0.3,
  removal: 0.25,
  wipe: 0.15,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function toRatingProfile(cards: readonly OptimizerCard[], format: Format): RatingProfile {
  const profile = deckProfile(cards, format);
  const stats = deckStats(cards);
  return {
    format,
    themes: profile.themes,
    tribes: profile.tribes,
    gaps: profile.gaps,
    keywords: profile.keywords,
    signals: profile.signals ?? deckSignalProfile(cards.map((c) => ({ ...c, text: c.text ?? "" }))),
    averageManaValue: profile.averageManaValue ?? stats.averageManaValue,
    curveCounts: profile.curveCounts ?? new Map(),
  };
}

function computeRoleCoverage(tags: Readonly<Record<Tag, number>>, format: Format): number {
  const targets = roleTargets(format);
  if (targets === null) return 75;
  let score = 0;
  for (const [tag, weight] of Object.entries(ROLE_WEIGHTS) as [TargetedTag, number][]) {
    const target = targets[tag];
    const ratio = target <= 0 ? 1 : clamp01((tags[tag] ?? 0) / target);
    score += ratio * weight * 100;
  }
  return round2(score);
}

function computeCurveScore(averageManaValue: number, format: Format): number {
  const targetMv = format === "commander" ? 3.1 : 2.4;
  const diff = Math.abs(averageManaValue - targetMv);
  return round2(Math.max(0, 100 - diff * 25));
}

function computeColorBalance(
  pips: Readonly<Record<string, number>>,
  sources: Readonly<Record<string, number>>,
): number {
  const totalPips = MANA_COLORS.reduce((sum, c) => sum + (pips[c] ?? 0), 0);
  if (totalPips === 0) return 100;
  const totalSources = MANA_COLORS.reduce((sum, c) => sum + (sources[c] ?? 0), 0);
  if (totalSources === 0) return 0;

  let penalty = 0;
  for (const color of MANA_COLORS) {
    const pipShare = (pips[color] ?? 0) / totalPips;
    if (pipShare === 0) continue;
    const sourceShare = (sources[color] ?? 0) / totalSources;
    if (sourceShare < pipShare) {
      penalty += (pipShare - sourceShare) * 140;
    }
  }
  return round2(Math.max(0, 100 - penalty));
}

function computeSynergyCohesion(
  nonLandMain: readonly OptimizerCard[],
  ratingProfile: RatingProfile,
  pairSimilarity?: (aOracleId: string, bOracleId: string) => number | null,
): number {
  if (nonLandMain.length === 0) return 50;

  let matchedCards = 0;
  for (const card of nonLandMain) {
    const io = cardSignalIO({
      name: card.name,
      typeLine: card.typeLine,
      text: card.text ?? "",
      manaValue: card.manaValue,
    });
    if (synergyMatches(io, ratingProfile.signals).matches.length > 0) matchedCards += 1;
  }
  const signalScore = clamp01(matchedCards / Math.max(1, nonLandMain.length * 0.5)) * 100;

  if (pairSimilarity === undefined || nonLandMain.length < 2) {
    return round2(signalScore);
  }

  let simSum = 0;
  let simCount = 0;
  for (let i = 0; i < nonLandMain.length; i++) {
    for (let j = i + 1; j < nonLandMain.length; j++) {
      const sim = pairSimilarity(nonLandMain[i].oracleId, nonLandMain[j].oracleId);
      if (sim !== null) {
        simSum += sim;
        simCount += 1;
      }
    }
  }
  if (simCount === 0) return round2(signalScore);
  const meanSim = simSum / simCount;
  // Cosine similarity for unrelated MTG cards sits around ~0.40–0.45; coherent ~0.65+.
  const embedScore = clamp01((meanSim - 0.4) / 0.3) * 100;
  return round2(signalScore * 0.5 + embedScore * 0.5);
}

/**
 * Pure whole-deck objective scoring a complete decklist across card quality,
 * role coverage, mana curve, color balance, synergy cohesion, bracket limits, and budget.
 */
export function scoreDeck(cards: readonly OptimizerCard[], context: ScoreDeckContext): DeckScore {
  const stats = deckStats(cards);
  const ratingProfile = toRatingProfile(cards, context.format);
  const targetBracket = context.targetBracket ?? null;

  const nonLandMain = cards.filter((c) => c.board === "main" && !isLand(c.typeLine));
  let ratingSum = 0;
  let ratingCount = 0;
  for (const card of nonLandMain) {
    const r = rateCard(
      {
        oracleId: card.oracleId,
        name: card.name,
        typeLine: card.typeLine,
        manaValue: card.manaValue,
        text: card.text,
        keywords: card.keywords,
        roles: card.roles,
        themes: card.themes,
        rarity: card.rarity,
        priceCents: card.priceCents ?? null,
        edhrec: card.edhrec,
        edhrecRank: card.edhrecRank,
        preconCount: card.preconCount,
        isGameChanger: card.isGameChanger,
        comboPartners: card.comboPartners,
        embedSim: card.embedSim,
      },
      ratingProfile,
      { targetBracket },
    );
    ratingSum += r.rating * card.quantity;
    ratingCount += card.quantity;
  }

  const cardQuality = round2(ratingCount === 0 ? 0 : ratingSum / ratingCount);
  const roleCoverage = computeRoleCoverage(stats.tags, context.format);
  const curveScore = computeCurveScore(stats.averageManaValue, context.format);
  const colorBalance = computeColorBalance(stats.pips, stats.sources);
  const synergyCohesion = computeSynergyCohesion(
    nonLandMain,
    ratingProfile,
    context.pairSimilarity,
  );

  const bracketLines = cards.map((c) =>
    bracketLine({
      name: c.name,
      quantity: c.quantity,
      board: c.board,
      typeLine: c.typeLine,
      text: c.text ?? "",
      isGameChanger: c.isGameChanger ?? false,
    }),
  );
  const bracketEst = estimateBracket(context.format, bracketLines);
  const gameChangerCount = bracketEst?.gameChangers ?? 0;

  let bracketPenalty = 0;
  if (targetBracket !== null && bracketEst !== null && bracketEst.floor > targetBracket) {
    bracketPenalty = round2(40 * (bracketEst.floor - targetBracket));
  }

  const addedPriceCents = context.addedPriceCents ?? 0;
  let budgetPenalty = 0;
  if (
    context.maxAddedPriceCents !== undefined &&
    context.maxAddedPriceCents !== null &&
    addedPriceCents > context.maxAddedPriceCents
  ) {
    const excessRatio =
      (addedPriceCents - context.maxAddedPriceCents) / Math.max(100, context.maxAddedPriceCents);
    budgetPenalty = round2(Math.min(60, 10 + excessRatio * 40));
  }

  const total = round2(
    cardQuality * OBJECTIVE_WEIGHTS.cardQuality +
      roleCoverage * OBJECTIVE_WEIGHTS.roleCoverage +
      curveScore * OBJECTIVE_WEIGHTS.curveScore +
      colorBalance * OBJECTIVE_WEIGHTS.colorBalance +
      synergyCohesion * OBJECTIVE_WEIGHTS.synergyCohesion -
      bracketPenalty -
      budgetPenalty,
  );

  return {
    total,
    cardQuality,
    roleCoverage,
    curveScore,
    colorBalance,
    synergyCohesion,
    bracketPenalty,
    budgetPenalty,
    metrics: {
      averageManaValue: round2(stats.averageManaValue),
      rampCount: stats.tags.ramp,
      drawCount: stats.tags.draw,
      removalCount: stats.tags.removal,
      wipeCount: stats.tags.wipe,
      cardQualityMean: cardQuality,
      gameChangerCount,
      addedPriceCents,
    },
  };
}

function addedCostForSwaps(swapsBySlot: ReadonlyMap<number, OptimizerCard>): number {
  let total = 0;
  for (const add of swapsBySlot.values()) {
    total += (add.priceCents ?? 0) * add.quantity;
  }
  return total;
}

/**
 * Optimizes a deck via Simulated Annealing using an injected `Rng`,
 * searching up to `maxSwaps` multi-card replacements from `candidatePool`.
 */
export function optimizeDeck(
  currentDeck: readonly OptimizerCard[],
  candidatePool: readonly OptimizerCard[],
  options: OptimizeOptions,
): OptimizeResult {
  const maxSwaps = Math.max(1, Math.min(15, options.maxSwaps ?? 5));
  const iterations = Math.max(1, options.iterations ?? 350);
  const initialTemp = options.initialTemp ?? 5.0;
  const coolingRate = options.coolingRate ?? 0.985;
  const locked = options.lockedOracleIds ?? new Set<string>();

  const existingOracleIds = new Set(currentDeck.map((c) => c.oracleId));
  const eligibleCandidates = candidatePool.filter(
    (c) => !isLand(c.typeLine) && !existingOracleIds.has(c.oracleId),
  );

  const swappableIndices: number[] = [];
  for (let i = 0; i < currentDeck.length; i++) {
    const card = currentDeck[i];
    if (
      card.board === "main" &&
      card.quantity === 1 &&
      !isLand(card.typeLine) &&
      !locked.has(card.oracleId)
    ) {
      swappableIndices.push(i);
    }
  }

  const baseContext: ScoreDeckContext = {
    format: options.format,
    targetBracket: options.targetBracket,
    maxAddedPriceCents: options.maxAddedPriceCents,
    pairSimilarity: options.pairSimilarity,
  };

  const before = scoreDeck(currentDeck, { ...baseContext, addedPriceCents: 0 });
  if (swappableIndices.length === 0 || eligibleCandidates.length === 0) {
    return {
      before,
      after: before,
      delta: 0,
      swaps: [],
      iterationsRun: 0,
      acceptedMoves: 0,
      improvedMoves: 0,
    };
  }

  let currentSwaps = new Map<number, OptimizerCard>();
  let currentScore = before;
  let bestSwaps = new Map<number, OptimizerCard>();
  let bestScore = before;

  let temp = initialTemp;
  let acceptedMoves = 0;
  let improvedMoves = 0;

  for (let step = 0; step < iterations; step++) {
    const nextSwaps = new Map(currentSwaps);
    const usedCandidateIds = new Set([...nextSwaps.values()].map((c) => c.oracleId));
    const availableCandidates = eligibleCandidates.filter((c) => !usedCandidateIds.has(c.oracleId));
    const unusedSlots = swappableIndices.filter((idx) => !nextSwaps.has(idx));

    const roll = options.rng.next();
    if (nextSwaps.size > 0 && unusedSlots.length > 0 && roll < 0.25) {
      // Shift an existing add to a different cut slot so SA can refine which card is cut.
      const activeSlots = [...nextSwaps.keys()];
      const oldSlot = activeSlots[randomInt(options.rng, activeSlots.length)];
      const newSlot = unusedSlots[randomInt(options.rng, unusedSlots.length)];
      const addCard = nextSwaps.get(oldSlot);
      if (addCard === undefined) continue;
      nextSwaps.delete(oldSlot);
      nextSwaps.set(newSlot, addCard);
    } else if (nextSwaps.size > 0 && (availableCandidates.length === 0 || roll < 0.4)) {
      const activeSlots = [...nextSwaps.keys()];
      const slot = activeSlots[randomInt(options.rng, activeSlots.length)];
      nextSwaps.delete(slot);
    } else if (availableCandidates.length > 0) {
      const candidate = availableCandidates[randomInt(options.rng, availableCandidates.length)];
      let slot: number;
      if (nextSwaps.size >= maxSwaps || unusedSlots.length === 0) {
        const activeSlots = [...nextSwaps.keys()];
        slot = activeSlots[randomInt(options.rng, activeSlots.length)];
      } else {
        slot = unusedSlots[randomInt(options.rng, unusedSlots.length)];
      }
      nextSwaps.set(slot, { ...candidate, board: "main", quantity: 1 });
    } else {
      temp *= coolingRate;
      continue;
    }

    const nextDeck = currentDeck.map((card, idx) => nextSwaps.get(idx) ?? card);
    const nextScore = scoreDeck(nextDeck, {
      ...baseContext,
      addedPriceCents: addedCostForSwaps(nextSwaps),
    });

    const delta = nextScore.total - currentScore.total;
    const accept = delta >= 0 || (temp > 1e-6 && options.rng.next() < Math.exp(delta / temp));

    if (accept) {
      currentSwaps = nextSwaps;
      currentScore = nextScore;
      acceptedMoves += 1;
      if (delta > 0) improvedMoves += 1;
      if (nextScore.total > bestScore.total) {
        bestSwaps = new Map(nextSwaps);
        bestScore = nextScore;
      }
    }

    temp *= coolingRate;
  }

  const bestDeck = currentDeck.map((card, idx) => bestSwaps.get(idx) ?? card);
  const beforeProfile = toRatingProfile(currentDeck, options.format);
  const afterProfile = toRatingProfile(bestDeck, options.format);

  const swaps: OptimizedSwap[] = [];
  for (const [slotIdx, add] of bestSwaps.entries()) {
    const cut = currentDeck[slotIdx];
    const cutRating = rateCard(
      {
        oracleId: cut.oracleId,
        name: cut.name,
        typeLine: cut.typeLine,
        manaValue: cut.manaValue,
        text: cut.text,
        keywords: cut.keywords,
        roles: cut.roles,
        themes: cut.themes,
        rarity: cut.rarity,
        priceCents: cut.priceCents ?? null,
        isGameChanger: cut.isGameChanger,
      },
      beforeProfile,
      { targetBracket: options.targetBracket },
    ).rating;
    const addRating = rateCard(
      {
        oracleId: add.oracleId,
        name: add.name,
        typeLine: add.typeLine,
        manaValue: add.manaValue,
        text: add.text,
        keywords: add.keywords,
        roles: add.roles,
        themes: add.themes,
        rarity: add.rarity,
        priceCents: add.priceCents ?? null,
        edhrec: add.edhrec,
        edhrecRank: add.edhrecRank,
        preconCount: add.preconCount,
        isGameChanger: add.isGameChanger,
        comboPartners: add.comboPartners,
        embedSim: add.embedSim,
      },
      afterProfile,
      { targetBracket: options.targetBracket },
    ).rating;

    swaps.push({
      cut,
      add,
      netCardRatingGain: addRating - cutRating,
      priceCents: add.priceCents ?? null,
    });
  }

  swaps.sort((a, b) => b.netCardRatingGain - a.netCardRatingGain);

  return {
    before,
    after: bestScore,
    delta: round2(bestScore.total - before.total),
    swaps,
    iterationsRun: iterations,
    acceptedMoves,
    improvedMoves,
  };
}
