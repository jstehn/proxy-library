import type { Bracket } from "./brackets";
import type { RankedCut } from "./cuts";
import type { Format } from "./deck";
import type { Scored } from "./suggest";
import type { TargetedTag } from "./stats";

// One-step swap suggestions (design doc 47, #85): pair weak main-deck cards from `rankCuts`
// with top-rated replacements from `rateCard`, ensuring each swap improves rating or fixes
// an active deck problem (over-bracket, unowned). Pure and safe for the browser.

export type SwapReason =
  | Readonly<{ kind: "ratingGain"; cutRating: number; addRating: number }>
  | Readonly<{ kind: "fillsRole"; tag: TargetedTag }>
  | Readonly<{ kind: "preservesRole"; tag: TargetedTag }>
  | Readonly<{ kind: "similarEffect"; similarityPct: number }>
  | Readonly<{ kind: "fixesOverBracket"; target: Bracket }>
  | Readonly<{ kind: "fixesNotOwned" }>
  | Readonly<{ kind: "lowersCurve"; cutMv: number; addMv: number }>;

export type SwapCutMeta = Readonly<{
  manaValue: number;
  /** 0–100 `rateCard` rating of the existing card under the same deck profile. */
  rating: number;
  isBasicLand?: boolean;
  /** Targeted roles this cut card fills, for role-preserving swap pairing. */
  roles?: readonly TargetedTag[];
}>;

export type SwapOptions = Readonly<{
  format: Format;
  targetBracket: Bracket | null;
  /** Oracle IDs already present in the deck (enforces singleton rule in Commander). */
  existingOracleIds?: ReadonlySet<string>;
  /** Role tags currently below target in the deck. */
  neededRoles?: ReadonlySet<TargetedTag>;
  /** Optional cosine similarity in [0, 1] between cut and add cards. */
  cutAddSimilarity?: (cutOracleId: string, addOracleId: string) => number | null;
  limit?: number;
}>;

export type SwapSuggestion = Readonly<{
  cut: RankedCut;
  add: Scored;
  /** Net improvement: `addRating - cutRating`, plus problem-fix bonus. */
  netGain: number;
  reasons: readonly SwapReason[];
}>;

const PROBLEM_FIX_BONUS = 15;
const ROLE_PRESERVE_BONUS = 8;
const SIMILAR_EFFECT_BONUS = 10;
const SIMILAR_EFFECT_MIN = 0.65;
const DEFAULT_LIMIT = 5;
const MAX_CUTS_CONSIDERED = 15;

export function suggestSwaps(
  cuts: readonly RankedCut[],
  cutMetaByOracleId: ReadonlyMap<string, SwapCutMeta>,
  candidates: readonly Scored[],
  options: SwapOptions,
): SwapSuggestion[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) return [];

  const existing = options.existingOracleIds ?? new Set<string>();
  const neededRoles = options.neededRoles ?? new Set<TargetedTag>();
  const disallowGameChanger = options.targetBracket !== null && options.targetBracket <= 2;

  const eligibleAdds = candidates.filter((c) => {
    if (options.format === "commander" && existing.has(c.card.oracleId)) return false;
    if (disallowGameChanger && c.card.isGameChanger) return false;
    return true;
  });

  if (eligibleAdds.length === 0) return [];

  const usedAddIds = new Set<string>();
  const suggestions: SwapSuggestion[] = [];

  for (const cut of cuts.slice(0, MAX_CUTS_CONSIDERED)) {
    const meta = cutMetaByOracleId.get(cut.oracleId);
    if (!meta || meta.isBasicLand) continue;

    const fixesOverBracket = cut.reasons.some((r) => r.kind === "overBracket");
    const fixesNotOwned = cut.reasons.some((r) => r.kind === "notOwned");
    const fixesProblem = fixesOverBracket || fixesNotOwned;

    const cutRoles = new Set(meta.roles ?? []);
    let bestAdd: Scored | null = null;
    let bestPairScore = -Infinity;
    let bestRatingDelta = 0;
    let bestPreservedRoles: TargetedTag[] = [];
    let bestSim: number | null = null;

    for (const candidate of eligibleAdds) {
      if (usedAddIds.has(candidate.card.oracleId)) continue;
      const addRating = candidate.rating?.rating ?? Math.round(candidate.score * 10);
      const ratingDelta = addRating - meta.rating;
      if (ratingDelta <= 0 && !fixesProblem) continue;

      const preserved = candidate.card.roles.filter((role): role is TargetedTag =>
        cutRoles.has(role as TargetedTag),
      );
      const sim = options.cutAddSimilarity?.(cut.oracleId, candidate.card.oracleId) ?? null;
      const simBonus = sim !== null && sim >= SIMILAR_EFFECT_MIN ? SIMILAR_EFFECT_BONUS * sim : 0;
      const pairScore =
        ratingDelta +
        (fixesProblem ? PROBLEM_FIX_BONUS : 0) +
        (preserved.length > 0 ? ROLE_PRESERVE_BONUS : 0) +
        simBonus;

      if (pairScore > bestPairScore) {
        bestPairScore = pairScore;
        bestAdd = candidate;
        bestRatingDelta = ratingDelta;
        bestPreservedRoles = preserved;
        bestSim = sim !== null && sim >= SIMILAR_EFFECT_MIN ? sim : null;
      }
    }

    if (!bestAdd) continue;

    const addRating = bestAdd.rating?.rating ?? Math.round(bestAdd.score * 10);
    const netGain = bestRatingDelta + (fixesProblem ? PROBLEM_FIX_BONUS : 0);

    const reasons: SwapReason[] = [];
    if (bestRatingDelta > 0) {
      reasons.push({ kind: "ratingGain", cutRating: meta.rating, addRating });
    }
    if (fixesOverBracket && options.targetBracket !== null) {
      reasons.push({ kind: "fixesOverBracket", target: options.targetBracket });
    }
    if (fixesNotOwned) {
      reasons.push({ kind: "fixesNotOwned" });
    }
    for (const tag of bestPreservedRoles) {
      reasons.push({ kind: "preservesRole", tag });
    }
    if (bestSim !== null) {
      reasons.push({ kind: "similarEffect", similarityPct: Math.round(bestSim * 100) });
    }
    for (const role of bestAdd.card.roles) {
      if (
        neededRoles.has(role as TargetedTag) &&
        !bestPreservedRoles.includes(role as TargetedTag)
      ) {
        reasons.push({ kind: "fillsRole", tag: role as TargetedTag });
      }
    }
    if (bestAdd.card.manaValue + 1 <= meta.manaValue) {
      reasons.push({ kind: "lowersCurve", cutMv: meta.manaValue, addMv: bestAdd.card.manaValue });
    }

    usedAddIds.add(bestAdd.card.oracleId);
    suggestions.push({ cut, add: bestAdd, netGain, reasons });
  }

  return suggestions
    .sort(
      (a, b) =>
        b.netGain - a.netGain ||
        b.add.score - a.add.score ||
        a.cut.keepScore - b.cut.keepScore ||
        a.cut.oracleId.localeCompare(b.cut.oracleId) ||
        a.add.card.oracleId.localeCompare(b.add.card.oracleId),
    )
    .slice(0, limit);
}
