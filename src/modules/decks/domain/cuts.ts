import { bracketFlags, cardTags, cardThemes, type BracketFlag } from "@/shared/card-search";
import type { Board } from "./boards";
import { bracketLine, flagsOverTarget, type Bracket } from "./brackets";
import type { Format } from "./deck";
import { deckStats, isLand, roleTargets, TARGETED_TAGS, type TargetedTag } from "./stats";
import {
  deckFit,
  deckProfile,
  strength,
  type EdhrecSignal,
  type ProfileLine,
  type Reason,
} from "./suggest";

// Cards to cut (design doc 32, section 3): the deck's weakest main-deck cards, weakest first,
// each with the reasons for its score. The same local rules as suggestions (design doc 20) judge
// how well a card fits; roles, the curve, the target bracket and ownership adjust it. Pure: the
// builder runs it in the browser and `rank_cuts` on the server.

/** A deck line as the cut ranking reads it. */
export type CutLine = ProfileLine &
  Readonly<{
    oracleId: string;
    name: string;
    board: Board;
    text: string;
    keywords: readonly string[];
    rarity: string;
    isGameChanger: boolean;
    /** Copies counted as owned in this deck. */
    owned: number;
    /** Community EDHREC stats under this deck's commander (design doc 45). */
    edhrec?: EdhrecSignal | null;
  }>;

/** Why a card scores as it does; the builder and `rank_cuts` put these into words. */
export type CutReason =
  /** Fits none of the deck's themes, tribes or commander keywords. */
  | Readonly<{ kind: "noFit" }>
  /** What it does fit (design doc 20's reasons): why to keep it. */
  | Readonly<{ kind: "fits"; reasons: readonly Reason[] }>
  /** Popular or high-synergy with this commander on EDHREC (design doc 45). */
  | Readonly<{ kind: "edhrec"; inclusionPct: number; synergyPct: number }>
  /** The deck has more of this role than its target needs. */
  | Readonly<{ kind: "surplusRole"; tag: TargetedTag; count: number; target: number }>
  /** The deck has no more of this role than it needs: cutting it would leave a gap. */
  | Readonly<{ kind: "neededRole"; tag: TargetedTag; count: number; target: number }>
  /** Expensive, in a deck whose curve is already high. */
  | Readonly<{ kind: "topHeavy"; manaValue: number; average: number }>
  /** It takes the deck over the bracket the player aims for (design doc 31). */
  | Readonly<{ kind: "overBracket"; target: Bracket; flags: readonly BracketFlag[] }>
  /** You don't own every copy. */
  | Readonly<{ kind: "notOwned"; short: number }>;

export type RankedCut = Readonly<{
  oracleId: string;
  name: string;
  /** How much the card earns its place: lower is a better cut. */
  keepScore: number;
  reasons: readonly CutReason[];
}>;

export type CutContext = Readonly<{ format: Format; targetBracket: Bracket | null }>;

/** The points each part of the keep score is worth (section 3's table), in one place to tune. */
export const CUT_WEIGHTS = {
  neededRole: 3,
  surplusRole: -1,
  /** A role counts as surplus only this far over its target. */
  surplusMargin: 2,
  /** Points lost per mana above 4, at most `topHeavyMost`. */
  topHeavyPerMana: -1,
  topHeavyMost: -3,
  topHeavyFrom: 5,
  overBracket: -5,
  notOwned: -1,
  strength: 0.5,
  edhrecSynergy: 2,
  edhrecInclusion: 1.5,
} as const;

/** Average non-land mana value above which a curve counts as high (a rough guide per format). */
function curveGuide(format: Format): number {
  return format === "commander" ? 3.3 : 3.0;
}

/**
 * The deck's cut candidates, weakest first: main-deck cards that aren't lands (invariant 4).
 * Equal scores sort by name, then oracle id (invariant 5).
 */
export function rankCuts(lines: readonly CutLine[], context: CutContext): RankedCut[] {
  const profile = deckProfile(lines, context.format);
  // Roles are judged below, against the targets; the fit is only themes, tribes and keywords.
  const fitProfile = { ...profile, gaps: [] };
  const stats = deckStats(lines);
  const targets = roleTargets(context.format);
  const overFlags =
    context.targetBracket === null
      ? []
      : flagsOverTarget(lines.map(bracketLine), context.targetBracket);
  const isHigh = stats.averageManaValue > curveGuide(context.format);

  const candidates = lines.filter((line) => line.board === "main" && !isLand(line.typeLine));
  return candidates
    .map((line): RankedCut => {
      const reasons: CutReason[] = [];
      let score = 0;

      const facts = { typeLine: line.typeLine, text: line.text, producedMana: line.producedMana };
      const fit = deckFit(
        {
          oracleId: line.oracleId,
          name: line.name,
          typeLine: line.typeLine,
          manaValue: line.manaValue,
          keywords: line.keywords,
          roles: [], // judged below, against the role targets
          themes: cardThemes(facts),
          rarity: line.rarity,
          priceCents: line.priceCents ?? null,
          pool: "owned",
        },
        fitProfile,
      );
      if (fit.points === 0) reasons.push({ kind: "noFit" });
      else reasons.push({ kind: "fits", reasons: fit.reasons });
      score += fit.points;

      if (targets !== null) {
        const roles = cardTags(facts);
        for (const tag of TARGETED_TAGS.filter((one) => roles.includes(one))) {
          const count = stats.tags[tag];
          const target = targets[tag];
          if (count <= target) {
            score += CUT_WEIGHTS.neededRole;
            reasons.push({ kind: "neededRole", tag, count, target });
          } else if (count > target + CUT_WEIGHTS.surplusMargin) {
            score += CUT_WEIGHTS.surplusRole;
            reasons.push({ kind: "surplusRole", tag, count, target });
          }
        }
      }

      if (isHigh && line.manaValue >= CUT_WEIGHTS.topHeavyFrom) {
        score += Math.max(
          CUT_WEIGHTS.topHeavyMost,
          CUT_WEIGHTS.topHeavyPerMana * (line.manaValue - 4),
        );
        reasons.push({
          kind: "topHeavy",
          manaValue: line.manaValue,
          average: Math.round(stats.averageManaValue * 100) / 100,
        });
      }

      const flags = bracketFlags(line).filter((flag) => overFlags.includes(flag));
      if (context.targetBracket !== null && flags.length > 0) {
        score += CUT_WEIGHTS.overBracket;
        reasons.push({ kind: "overBracket", target: context.targetBracket, flags });
      }

      if (line.owned < line.quantity) {
        score += CUT_WEIGHTS.notOwned;
        reasons.push({ kind: "notOwned", short: line.quantity - line.owned });
      }

      if (line.edhrec && (line.edhrec.synergy >= 0.15 || line.edhrec.inclusionRate >= 0.3)) {
        score +=
          CUT_WEIGHTS.edhrecSynergy * Math.max(0, line.edhrec.synergy) +
          CUT_WEIGHTS.edhrecInclusion * Math.max(0, line.edhrec.inclusionRate);
        reasons.push({
          kind: "edhrec",
          inclusionPct: Math.round(line.edhrec.inclusionRate * 100),
          synergyPct: Math.round(line.edhrec.synergy * 100),
        });
      }

      score +=
        CUT_WEIGHTS.strength *
        strength({ rarity: line.rarity, priceCents: line.priceCents ?? null });
      return { oracleId: line.oracleId, name: line.name, keepScore: score, reasons };
    })
    .sort(
      (a, b) =>
        a.keepScore - b.keepScore ||
        a.name.localeCompare(b.name) ||
        a.oracleId.localeCompare(b.oracleId),
    );
}
