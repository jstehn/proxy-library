import { type BracketFlag } from "@/shared/kernel";
import type { Board } from "../../domain/boards";
import { bracketLine, flagsOverTarget, type Bracket } from "../../domain/brackets";
import type { Format } from "../../domain/deck";
import { formatRules } from "../../domain/format-rules";
import { rateCard } from "./rate";
import {
  deckStats,
  isLand,
  TARGETED_TAGS,
  type EdhrecSignal,
  type ProfileLine,
  type TargetedTag,
} from "../../domain/stats";
import {
  deckProfile,
  edhrecReason,
  fitReasons,
  type CandidateCard,
  type EdhrecReason,
  type Reason,
} from "./suggest";

// Cards to cut (design doc 32, section 3): the deck's main-deck cards that help it least, in that
// order, each with the reasons. They're judged by `rateCard`, the same scorer that orders
// suggestions, so "how much does this card help this deck?" has one answer; roles, the curve and
// the target bracket reach it as its inputs. Pure: the builder runs it in the browser and
// `rank_cuts` on the server.

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
    bracketFlags: readonly BracketFlag[];
    /** Copies counted as owned in this deck. */
    owned: number;
    /** Community EDHREC stats under this deck's commander (design doc 45). */
    edhrec?: EdhrecSignal | null;
    edhrecRank?: number | null;
    preconCount?: number | null;
    /** Mean cosine similarity to top-5 other non-land/commander cards in the deck. */
    embedSim?: number | null;
  }>;

/** Why a card is listed as it is; the builder and `rank_cuts` put these into words. */
export type CutReason =
  /** Fits none of the deck's themes, tribes or commander keywords. */
  | Readonly<{ kind: "noFit" }>
  /** What it does fit (design doc 20's reasons): why to keep it. */
  | Readonly<{ kind: "fits"; reasons: readonly Reason[] }>
  /** Popular or high-synergy with this commander on EDHREC (design doc 45). */
  | EdhrecReason
  /** The deck has more of this role than its target needs. */
  | Readonly<{ kind: "surplusRole"; tag: TargetedTag; count: number; target: number }>
  /** The deck has no more of this role than it needs: cutting it would leave a gap. */
  | Readonly<{ kind: "neededRole"; tag: TargetedTag; count: number; target: number }>
  /** Expensive, in a deck whose curve is already high. */
  | Readonly<{ kind: "topHeavy"; manaValue: number; average: number }>
  /** It takes the deck over the bracket the player aims for (design doc 31). */
  | Readonly<{ kind: "overBracket"; target: Bracket; flags: readonly BracketFlag[] }>
  /** You don't own every copy. */
  | Readonly<{ kind: "notOwned"; short: number }>
  /** Strong text similarity to other cards in the deck (design doc 53). */
  | Readonly<{ kind: "embedSim"; similarityPct: number }>;

export type RankedCut = Readonly<{
  oracleId: string;
  name: string;
  reasons: readonly CutReason[];
}>;

export type CutContext = Readonly<{ format: Format; targetBracket: Bracket | null }>;

/** A role counts as surplus only this far over its target. */
const SURPLUS_MARGIN = 2;
/** The mana value from which a card is "top heavy" in a deck whose curve is high. */
const TOP_HEAVY_FROM = 5;
/** A card with this much EDHREC inclusion is a staple, even if it fits no theme. */
const STAPLE_INCLUSION = 0.25;

/**
 * The deck's cut candidates, the card that helps the deck least first: main-deck cards that
 * aren't lands (invariant 4). Equal ratings put the cards you don't own first, then sort by name,
 * then oracle id (invariant 5).
 */
export function rankCuts(lines: readonly CutLine[], context: CutContext): RankedCut[] {
  const profile = deckProfile(lines, context.format);
  const stats = deckStats(lines);
  const targets = formatRules(context.format).roleTargets;
  const overFlags =
    context.targetBracket === null
      ? []
      : flagsOverTarget(lines.map(bracketLine), context.targetBracket);
  const isHigh = stats.averageManaValue > formatRules(context.format).curveGuide;

  const candidates = lines.filter((line) => line.board === "main" && !isLand(line.typeLine));
  return candidates
    .map((line) => {
      const flags = line.bracketFlags.filter((flag) => overFlags.includes(flag));
      const overBracket = context.targetBracket !== null && flags.length > 0;
      const card: CandidateCard = {
        ...line,
        roles: line.roles ?? [],
        themes: line.themes ?? [],
        priceCents: line.priceCents ?? null,
        overBracket,
        pool: "owned",
      };
      const rating = rateCard(card, profile, { targetBracket: context.targetBracket });
      const reasons: CutReason[] = [];

      // Roles are judged below, against the targets; the fit is themes, tribes and keywords.
      const fit = fitReasons(card, { ...profile, gaps: [] });
      const synergy = rating.parts.find((part) => part.kind === "synergy");
      if (synergy) fit.push({ kind: "synergy", label: synergy.label });
      if (fit.length > 0) reasons.push({ kind: "fits", reasons: fit });
      else if ((line.edhrec?.inclusionRate ?? 0) < STAPLE_INCLUSION)
        reasons.push({ kind: "noFit" });

      if (targets !== null) {
        for (const tag of TARGETED_TAGS.filter((one) => (line.roles ?? []).includes(one))) {
          const count = stats.tags[tag];
          const target = targets[tag];
          if (count <= target) reasons.push({ kind: "neededRole", tag, count, target });
          else if (count > target + SURPLUS_MARGIN) {
            reasons.push({ kind: "surplusRole", tag, count, target });
          }
        }
      }

      if (isHigh && line.manaValue >= TOP_HEAVY_FROM) {
        const average = Math.round(stats.averageManaValue * 100) / 100;
        reasons.push({ kind: "topHeavy", manaValue: line.manaValue, average });
      }
      if (context.targetBracket !== null && overBracket) {
        reasons.push({ kind: "overBracket", target: context.targetBracket, flags });
      }
      const short = Math.max(0, line.quantity - line.owned);
      if (short > 0) reasons.push({ kind: "notOwned", short });
      const edhrec = edhrecReason(line.edhrec, 0.15, STAPLE_INCLUSION);
      if (edhrec !== null) reasons.push(edhrec);
      if (line.embedSim != null && rating.parts.some((part) => part.kind === "embedSim")) {
        reasons.push({ kind: "embedSim", similarityPct: Math.round(line.embedSim * 100) });
      }
      return {
        cut: { oracleId: line.oracleId, name: line.name, reasons },
        logit: rating.logit,
        short,
      };
    })
    .sort(
      (a, b) =>
        a.logit - b.logit ||
        b.short - a.short ||
        a.cut.name.localeCompare(b.cut.name) ||
        a.cut.oracleId.localeCompare(b.cut.oracleId),
    )
    .map((entry) => entry.cut);
}
