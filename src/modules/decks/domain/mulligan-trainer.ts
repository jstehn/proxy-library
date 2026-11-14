import { shuffled, type Rng } from "@/shared/kernel";
import { EARLY_RAMP_MAX_MV, OPENING_HAND, type LibraryCard } from "./draws";

export type MulliganChoice = "keep" | "mulligan";

export type MulliganDrill = Readonly<{
  hand: readonly LibraryCard[];
  mulliganCount: number;
  keepCount: number;
  landCount: number;
  earlyRampCount: number;
  earlyPlayCount: number;
  recommended: MulliganChoice;
  reasons: readonly string[];
}>;

export type MulliganEvaluation = Readonly<{
  decision: MulliganChoice;
  recommended: MulliganChoice;
  correct: boolean;
  reasons: readonly string[];
  landCount: number;
  earlyRampCount: number;
  earlyPlayCount: number;
}>;

export type MulliganDrillOptions = Readonly<{
  mulliganCount?: number;
  freeFirstMulligan?: boolean;
  minLands?: number;
  maxLands?: number;
}>;

function isEarlyPlay(card: LibraryCard): boolean {
  return !card.isLand && (card.manaValue ?? 99) <= EARLY_RAMP_MAX_MV;
}

function isEarlyRamp(card: LibraryCard): boolean {
  return isEarlyPlay(card) && card.tags.includes("ramp");
}

/**
 * Deals a 7-card opening hand for a keep-or-mulligan drill using an injected `Rng`,
 * along with the recommended decision and plain-English reasons.
 */
export function dealMulliganDrill(
  cards: readonly LibraryCard[],
  rng: Rng,
  options: MulliganDrillOptions = {},
): MulliganDrill {
  const mulliganCount = Math.max(0, Math.min(4, options.mulliganCount ?? 0));
  const freeFirstMulligan = options.freeFirstMulligan ?? true;
  const minLands = Math.max(0, Math.min(7, options.minLands ?? 2));
  const maxLands = Math.max(minLands, Math.min(7, options.maxLands ?? 4));

  const hand = shuffled(rng, cards).slice(0, OPENING_HAND);
  const toBottom = freeFirstMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount;
  const keepCount = Math.max(1, OPENING_HAND - toBottom);

  const landCount = hand.filter((c) => c.isLand).length;
  const earlyRampCount = hand.filter(isEarlyRamp).length;
  const earlyPlayCount = hand.filter(isEarlyPlay).length;

  const reasons: string[] = [];
  if (landCount < minLands) {
    reasons.push(
      `Only ${landCount} land${landCount === 1 ? "" : "s"} (target ${minLands}–${maxLands}).`,
    );
  } else if (landCount > maxLands) {
    reasons.push(`Too many lands (${landCount}; target ${minLands}–${maxLands}).`);
  } else {
    reasons.push(`${landCount} lands is right in the ${minLands}–${maxLands} sweet spot.`);
  }

  if (earlyRampCount > 0) {
    reasons.push(
      `${earlyRampCount} early ramp piece${earlyRampCount === 1 ? "" : "s"} (MV ≤ ${EARLY_RAMP_MAX_MV}).`,
    );
  } else if (earlyPlayCount > 0) {
    reasons.push(
      `${earlyPlayCount} early play${earlyPlayCount === 1 ? "" : "s"} (MV ≤ ${EARLY_RAMP_MAX_MV}).`,
    );
  } else {
    reasons.push(`No early plays at MV ≤ ${EARLY_RAMP_MAX_MV}.`);
  }

  const keepable = landCount >= minLands && landCount <= maxLands && earlyPlayCount > 0;
  const recommended: MulliganChoice = keepable ? "keep" : "mulligan";

  return {
    hand,
    mulliganCount,
    keepCount,
    landCount,
    earlyRampCount,
    earlyPlayCount,
    recommended,
    reasons,
  };
}

/**
 * Evaluates a player's keep-or-mulligan choice against the drill recommendation.
 */
export function evaluateMulliganDecision(
  drill: MulliganDrill,
  decision: MulliganChoice,
): MulliganEvaluation {
  return {
    decision,
    recommended: drill.recommended,
    correct: decision === drill.recommended,
    reasons: drill.reasons,
    landCount: drill.landCount,
    earlyRampCount: drill.earlyRampCount,
    earlyPlayCount: drill.earlyPlayCount,
  };
}
