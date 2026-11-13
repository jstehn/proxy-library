import type { Bracket } from "./brackets";
import type { Format } from "./deck";
import { powerTierForBracket, type PowerTier, type RatingWeights } from "./rate";
import { isLand } from "./stats";
import { deckProfile, rank, scoreForDeck, type CandidateCard, type ProfileLine } from "./suggest";

// Hold-out evaluation harness (design doc 46, #57):
// hide `holdoutCount` non-land, non-commander cards from a decklist, score a candidate pool,
// and measure Recall@K and Mean Reciprocal Rank (MRR).

export type EvalDeckLine = ProfileLine &
  Readonly<{
    oracleId: string;
    name: string;
    candidate: CandidateCard;
  }>;

export type EvalResult = Readonly<{
  tier: PowerTier;
  holdoutCount: number;
  k: number;
  hits: number;
  recallAtK: number;
  mrr: number;
}>;

export function evaluateHoldout(
  lines: readonly EvalDeckLine[],
  distractors: readonly CandidateCard[],
  options: {
    format?: Format;
    holdoutCount?: number;
    k?: number;
    targetBracket?: Bracket | null;
    embedSimByOracleId?: ReadonlyMap<string, number>;
    weightsOverride?: RatingWeights;
  } = {},
): EvalResult {
  const format = options.format ?? "commander";
  const holdoutCount = options.holdoutCount ?? 10;
  const k = options.k ?? 50;
  const targetBracket = options.targetBracket ?? null;

  const eligible = lines.filter((line) => line.board === "main" && !isLand(line.typeLine));
  // Deterministic stride selection so tests and weight-tuning runs are reproducible.
  const step = Math.max(1, Math.floor(eligible.length / Math.max(1, holdoutCount)));
  const heldOutIds = new Set<string>();
  for (let i = 0; i < eligible.length && heldOutIds.size < holdoutCount; i += step) {
    heldOutIds.add(eligible[i].oracleId);
  }
  for (const line of eligible) {
    if (heldOutIds.size >= holdoutCount) break;
    heldOutIds.add(line.oracleId);
  }

  const remaining = lines.filter((line) => !heldOutIds.has(line.oracleId));
  const heldOutCards = eligible
    .filter((line) => heldOutIds.has(line.oracleId))
    .map((line) => line.candidate);

  const profile = deckProfile(remaining, format);
  const poolById = new Map<string, CandidateCard>();
  for (const card of [...heldOutCards, ...distractors]) {
    if (!poolById.has(card.oracleId)) poolById.set(card.oracleId, card);
  }

  const ranked = rank(
    [...poolById.values()].map((card) => {
      const embedSim = options.embedSimByOracleId?.get(card.oracleId);
      const withSim = embedSim !== undefined ? { ...card, embedSim } : card;
      return scoreForDeck(withSim, profile, {
        targetBracket,
        weightsOverride: options.weightsOverride,
      });
    }),
  );
  const topK = ranked.slice(0, k);
  const hits = topK.filter((entry) => heldOutIds.has(entry.card.oracleId)).length;

  let rrSum = 0;
  for (let idx = 0; idx < ranked.length; idx++) {
    if (heldOutIds.has(ranked[idx].card.oracleId)) {
      rrSum += 1 / (idx + 1);
    }
  }

  const actualHoldout = heldOutIds.size;
  return {
    tier: powerTierForBracket(targetBracket),
    holdoutCount: actualHoldout,
    k,
    hits,
    recallAtK: actualHoldout === 0 ? 0 : hits / actualHoldout,
    mrr: actualHoldout === 0 ? 0 : rrSum / actualHoldout,
  };
}
