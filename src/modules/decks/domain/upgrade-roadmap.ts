import type { Tag } from "@/shared/card-search";
import type { Bracket } from "./brackets";
import type { Format } from "./deck";
import { scoreDeck, type DeckScore, type OptimizerCard } from "./optimize";

export const DEFAULT_UPGRADE_TIERS_CENTS: readonly number[] = [2500, 7500, 20000];

export type UpgradeCut = Readonly<{
  oracleId: string;
  name: string;
  keepScore: number;
  manaValue: number;
  roles: readonly Tag[];
}>;

export type UpgradeCandidate = Readonly<{
  card: OptimizerCard;
  rating: number;
  reasons: readonly string[];
  priceCents: number;
}>;

export type UpgradeSwap = Readonly<{
  cut: UpgradeCut;
  add: UpgradeCandidate;
  priceCents: number;
}>;

export type UpgradeTierPlan = Readonly<{
  tierBudgetCents: number;
  tierSpentCents: number;
  cumulativeBudgetCents: number;
  cumulativeSpentCents: number;
  swaps: readonly UpgradeSwap[];
  scoreAfter: DeckScore;
  scoreDeltaFromBase: number;
}>;

export type UpgradeRoadmap = Readonly<{
  baseScore: DeckScore;
  tiers: readonly UpgradeTierPlan[];
}>;

export type BuildUpgradeRoadmapInput = Readonly<{
  format: Format;
  targetBracket: Bracket | null;
  currentDeck: readonly OptimizerCard[];
  cuts: readonly UpgradeCut[];
  candidates: readonly UpgradeCandidate[];
  tiersCents?: readonly number[];
  maxSwapsPerTier?: number;
}>;

function applySwap(
  deck: readonly OptimizerCard[],
  cutOracleId: string,
  addCard: OptimizerCard,
): OptimizerCard[] {
  let removed = false;
  const next: OptimizerCard[] = [];
  for (const line of deck) {
    if (!removed && line.board === "main" && line.oracleId === cutOracleId) {
      removed = true;
      if (line.quantity > 1) {
        next.push({ ...line, quantity: line.quantity - 1 });
      }
      continue;
    }
    next.push(line);
  }
  const existingIdx = next.findIndex(
    (line) => line.board === "main" && line.oracleId === addCard.oracleId,
  );
  if (existingIdx >= 0) {
    const existing = next[existingIdx];
    next[existingIdx] = { ...existing, quantity: existing.quantity + 1 };
  } else {
    next.push({ ...addCard, board: "main", quantity: 1 });
  }
  return next;
}

/**
 * Builds a cumulative tiered cut/add swap roadmap across budget milestones (e.g. $25 / $75 / $200),
 * pairing weakest main-deck cuts with top-rated store upgrades and scoring each milestone.
 */
export function buildUpgradeRoadmap(input: BuildUpgradeRoadmapInput): UpgradeRoadmap {
  const rawTiers = input.tiersCents ?? DEFAULT_UPGRADE_TIERS_CENTS;
  const tiersCents = [...new Set(rawTiers.filter((c) => Number.isFinite(c) && c > 0))].sort(
    (a, b) => a - b,
  );
  const maxSwapsPerTier = Math.max(1, input.maxSwapsPerTier ?? 5);

  const baseScore = scoreDeck(input.currentDeck, {
    format: input.format,
    targetBracket: input.targetBracket,
  });

  const sortedCuts = [...input.cuts].sort((a, b) => a.keepScore - b.keepScore);
  const sortedAdds = [...input.candidates].sort((a, b) => b.rating - a.rating);

  const usedCutIds = new Set<string>();
  const usedAddIds = new Set<string>(input.currentDeck.map((c) => c.oracleId));

  let workingDeck = [...input.currentDeck];
  let prevCumulativeBudget = 0;
  let cumulativeSpentCents = 0;

  const tiers: UpgradeTierPlan[] = [];
  for (const cumulativeBudgetCents of tiersCents) {
    const tierBudgetCents = cumulativeBudgetCents - prevCumulativeBudget;
    let tierSpentCents = 0;
    const swaps: UpgradeSwap[] = [];

    while (swaps.length < maxSwapsPerTier) {
      const remaining = cumulativeBudgetCents - cumulativeSpentCents;
      if (remaining <= 0) break;

      const nextAdd = sortedAdds.find(
        (c) => !usedAddIds.has(c.card.oracleId) && c.priceCents >= 0 && c.priceCents <= remaining,
      );
      if (nextAdd === undefined) break;

      const nextCut = sortedCuts.find((c) => !usedCutIds.has(c.oracleId));
      if (nextCut === undefined) break;

      usedAddIds.add(nextAdd.card.oracleId);
      usedCutIds.add(nextCut.oracleId);
      workingDeck = applySwap(workingDeck, nextCut.oracleId, nextAdd.card);

      tierSpentCents += nextAdd.priceCents;
      cumulativeSpentCents += nextAdd.priceCents;
      swaps.push({
        cut: nextCut,
        add: nextAdd,
        priceCents: nextAdd.priceCents,
      });
    }

    const scoreAfter = scoreDeck(workingDeck, {
      format: input.format,
      targetBracket: input.targetBracket,
      addedPriceCents: cumulativeSpentCents,
    });
    tiers.push({
      tierBudgetCents,
      tierSpentCents,
      cumulativeBudgetCents,
      cumulativeSpentCents,
      swaps,
      scoreAfter,
      scoreDeltaFromBase: Number((scoreAfter.total - baseScore.total).toFixed(2)),
    });
    prevCumulativeBudget = cumulativeBudgetCents;
  }

  return { baseScore, tiers };
}
