import type { DbExecutor } from "@/shared/db";
import { seededRng, type UserId } from "@/shared/kernel";
import { isPlayed } from "../domain/boards";
import {
  bracketLine,
  bracketRuleReasons,
  bracketWarning,
  estimateBracket,
  type Bracket,
  type BracketRuleReason,
} from "../domain/brackets";
import { simulateCastOnCurve, type CardCastability } from "../domain/castability";
import { rankCuts } from "../domain/cuts";
import type { Format } from "../domain/deck";
import { library } from "../domain/draws";
import { simulateOpeningHands, type GoldfishReport } from "../domain/goldfish";
import { scoreDeck, type DeckScore } from "../domain/optimize";
import { deckProblems } from "../domain/rules";
import {
  deckStats,
  MANA_COLORS,
  roleTargets,
  suggestedLands,
  TARGETED_TAGS,
  type TargetedTag,
} from "../domain/stats";
import { combosForDeck } from "./combos";
import { deckView } from "./decks";
import { lineToOptimizerCard } from "./optimize";

export type AuditFinding = Readonly<{
  severity: "error" | "warning" | "info";
  area: "legality" | "bracket" | "mana" | "roles" | "goldfish" | "ownership";
  message: string;
}>;

export type AuditRoleStatus = Readonly<{
  tag: TargetedTag;
  count: number;
  target: number;
  deficit: number;
}>;

export type DeckAuditReport = Readonly<{
  deck: {
    id: number;
    name: string;
    format: Format;
    targetBracket: Bracket | null;
    cardCount: number;
    sideboardCount: number;
  };
  score: DeckScore;
  legality: {
    problemCount: number;
    problems: readonly string[];
  };
  bracket: {
    target: Bracket | null;
    floor: Bracket;
    overTarget: boolean;
    gameChangers: number;
    twoCardCombos: number;
    reasons: readonly BracketRuleReason[];
  } | null;
  roles: readonly AuditRoleStatus[];
  mana: {
    lands: number;
    suggestedLands: number;
    averageManaValue: number;
    underservedColors: readonly string[];
    averageCastOnCurvePct: number;
    strugglingSpells: readonly CardCastability[];
  };
  ownership: {
    ownedCards: number;
    missingCards: number;
    estimatedMissingCents: number;
  };
  topCuts: readonly { name: string; oracleId: string; score: number }[];
  goldfish: GoldfishReport;
  findings: readonly AuditFinding[];
}>;

/**
 * One-shot diagnostic audit combining legality, bracket/combos, whole-deck score,
 * role deficits, mana/color balance, ownership gaps, top cut candidates, and 500-hand goldfish stats.
 */
export async function auditDeck(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<DeckAuditReport | null> {
  const view = await deckView(db, userId, deckId);
  if (view === null) return null;

  const playedOracleIds = view.lines.filter((l) => isPlayed(l.board)).map((l) => l.oracleId);
  const combos = await combosForDeck(db, playedOracleIds);

  const ownedByOracle = new Map<string, number>();
  for (const line of view.lines) ownedByOracle.set(line.oracleId, line.owned);

  const problems = deckProblems(
    view.deck,
    (oracleId) => view.rules[oracleId],
    (oracleId) => ownedByOracle.get(oracleId) ?? 0,
  );

  const stats = deckStats(view.lines);
  const targets = roleTargets(view.deck.format);
  const roles: AuditRoleStatus[] =
    targets === null
      ? []
      : TARGETED_TAGS.map((tag) => {
          const count = stats.tags[tag] ?? 0;
          const target = targets[tag];
          return { tag, count, target, deficit: Math.max(0, target - count) };
        });

  const underservedColors: string[] = [];
  const totalPips = MANA_COLORS.reduce((s, c) => s + stats.pips[c], 0);
  const totalSources = MANA_COLORS.reduce((s, c) => s + stats.sources[c], 0);
  if (totalPips > 0 && totalSources > 0) {
    for (const color of MANA_COLORS) {
      if (stats.pips[color] === 0) continue;
      const pipShare = stats.pips[color] / totalPips;
      const sourceShare = stats.sources[color] / totalSources;
      if (sourceShare + 0.08 < pipShare) underservedColors.push(color);
    }
  }

  let ownedCards = 0;
  let missingCards = 0;
  let estimatedMissingCents = 0;
  for (const line of view.lines) {
    if (!isPlayed(line.board)) continue;
    const have = Math.min(line.quantity, line.owned);
    const short = Math.max(0, line.quantity - have);
    ownedCards += have;
    missingCards += short;
    estimatedMissingCents += short * (line.priceCents ?? 0);
  }

  const estimate = estimateBracket(view.deck.format, view.lines.map(bracketLine), {
    combos: combos ?? undefined,
  });
  const warning = estimate === null ? null : bracketWarning(estimate, view.deck.targetBracket);

  const score = scoreDeck(view.lines.filter((l) => isPlayed(l.board)).map(lineToOptimizerCard), {
    format: view.deck.format,
    targetBracket: view.deck.targetBracket,
  });

  const topCuts = rankCuts(view.lines, {
    format: view.deck.format,
    targetBracket: view.deck.targetBracket,
  })
    .slice(0, 5)
    .map((c) => ({ name: c.name, oracleId: c.oracleId, score: c.keepScore }));

  const goldfish = simulateOpeningHands(library(view.lines), {
    rng: seededRng(`audit-${deckId}`),
    trials: 500,
    freeMulligan: view.deck.format === "commander",
  });

  const castability = simulateCastOnCurve(view.lines, {
    rng: seededRng(`audit-mana-${deckId}`),
    trials: 400,
  });

  const findings: AuditFinding[] = [];
  if (problems.length > 0) {
    findings.push({
      severity: "error",
      area: "legality",
      message: `${problems.length} deck legality/construction issue(s) found.`,
    });
  }
  if (warning !== null) {
    findings.push({
      severity: "warning",
      area: "bracket",
      message: `Deck floor is Bracket ${warning.floor}, above target Bracket ${warning.target}.`,
    });
  }
  const landTarget = suggestedLands(view.deck.format);
  if (stats.lands < landTarget - 3) {
    findings.push({
      severity: "warning",
      area: "mana",
      message: `Low land count: ${stats.lands} lands vs. ${landTarget} suggested.`,
    });
  }
  if (underservedColors.length > 0) {
    findings.push({
      severity: "warning",
      area: "mana",
      message: `Color source share trails pip demand for: ${underservedColors.join(", ")}.`,
    });
  }
  if (castability.struggling.length > 0) {
    const worst = castability.struggling
      .slice(0, 3)
      .map((s) => `${s.name} (${Math.round(s.castOnCurvePct * 100)}%)`)
      .join(", ");
    findings.push({
      severity: "warning",
      area: "mana",
      message: `${castability.struggling.length} spell(s) below 75% cast-on-curve: ${worst}.`,
    });
  }
  for (const r of roles) {
    if (r.deficit >= 3) {
      findings.push({
        severity: "warning",
        area: "roles",
        message: `Short on ${r.tag}: ${r.count}/${r.target}.`,
      });
    }
  }
  if (goldfish.trials > 0 && goldfish.keepableRatePct < 65) {
    findings.push({
      severity: "warning",
      area: "goldfish",
      message: `Low keepable opening hand rate (${goldfish.keepableRatePct}%).`,
    });
  }
  if (missingCards > 0) {
    findings.push({
      severity: "info",
      area: "ownership",
      message: `Missing ${missingCards} played card(s) (est. $${(estimatedMissingCents / 100).toFixed(2)}).`,
    });
  }

  return {
    deck: {
      id: view.deck.id,
      name: view.deck.name,
      format: view.deck.format,
      targetBracket: view.deck.targetBracket,
      cardCount: stats.cardCount,
      sideboardCount: stats.sideboardCount,
    },
    score,
    legality: {
      problemCount: problems.length,
      problems: problems.map((p) => p.kind),
    },
    bracket:
      estimate === null
        ? null
        : {
            target: view.deck.targetBracket,
            floor: estimate.floor,
            overTarget: warning !== null,
            gameChangers: estimate.gameChangers,
            twoCardCombos: combos?.length ?? 0,
            reasons: bracketRuleReasons(estimate.findings),
          },
    roles,
    mana: {
      lands: stats.lands,
      suggestedLands: landTarget,
      averageManaValue: Math.round(stats.averageManaValue * 100) / 100,
      underservedColors,
      averageCastOnCurvePct: Math.round(castability.averageCastOnCurvePct * 100),
      strugglingSpells: castability.struggling.slice(0, 5),
    },
    ownership: {
      ownedCards,
      missingCards,
      estimatedMissingCents,
    },
    topCuts,
    goldfish,
    findings,
  };
}
