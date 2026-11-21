import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { Cents, COLORS, type UserId, seededRng } from "@/shared/kernel";
import { isPlayed } from "../domain/boards";
import {
  bracketLine,
  bracketRuleReasons,
  bracketWarning,
  estimateBracket,
} from "../domain/brackets";
import { simulateCastOnCurve } from "@/modules/decks/play/client";
import { resolveDeckProfileTargets, type DeckPlan } from "../domain/deck-profile";
import { decks } from "../infrastructure/schema";
import { library } from "@/modules/decks/play/client";
import { simulateOpeningHands } from "@/modules/decks/play/client";
import { scoreDeck } from "../domain/optimize";
import { deckProblems } from "../domain/rules";
import { formatRules } from "../domain/format-rules";
import { deckStats, TARGETED_TAGS } from "../domain/stats";
import type { AuditFinding, AuditRoleStatus, DeckAuditReport } from "../domain/audit-report";
import { combosForDeck } from "./combos";
import type { DeckView } from "../domain/deck-view";
import { deckView } from "./decks";
import { lineToOptimizerCard } from "./optimize";
import { withFeatures } from "./card-features";

/**
 * One-shot diagnostic audit combining legality, bracket/combos, whole-deck score,
 * role deficits, mana/color balance, ownership gaps, and 500-hand goldfish stats.
 */
export async function auditDeck(
  db: DbExecutor,
  userId: UserId,
  deckId: number,
): Promise<DeckAuditReport | null> {
  const view = await deckView(db, userId, deckId);
  if (view === null) return null;
  return auditDeckView(db, view);
}

/**
 * Runs the full diagnostic audit on an already-loaded `DeckView` (used by both
 * authenticated `auditDeck` and public shareable scorecards).
 */
export async function auditDeckView(db: DbExecutor, view: DeckView): Promise<DeckAuditReport> {
  const playedOracleIds = view.lines.filter((l) => isPlayed(l.board)).map((l) => l.oracleId);
  const [combos, profileRows] = await Promise.all([
    combosForDeck(db, playedOracleIds),
    db
      .select({ profileJson: decks.profileJson })
      .from(decks)
      .where(eq(decks.id, view.deck.id))
      .limit(1),
  ]);
  const deckProfile: DeckPlan | null = profileRows[0]?.profileJson ?? null;

  const ownedByOracle = new Map<string, number>();
  for (const line of view.lines) ownedByOracle.set(line.oracleId, line.owned);

  const problems = deckProblems(
    view.deck,
    (oracleId) => view.rules[oracleId],
    (oracleId) => ownedByOracle.get(oracleId) ?? 0,
  );

  const stats = deckStats(view.lines);
  const baseTargets = formatRules(view.deck.format).roleTargets;
  const resolved =
    baseTargets === null
      ? null
      : resolveDeckProfileTargets(deckProfile, null, {
          landTarget: formatRules(view.deck.format).suggestedLands,
          roleTargets: baseTargets,
        });
  const targets = resolved?.roleTargets ?? null;
  const roles: AuditRoleStatus[] =
    targets === null
      ? []
      : TARGETED_TAGS.map((tag) => {
          const count = stats.tags[tag] ?? 0;
          const target = targets[tag];
          return { tag, count, target, deficit: Math.max(0, target - count) };
        });

  const underservedColors: string[] = [];
  const totalPips = COLORS.reduce((s, c) => s + stats.pips[c], 0);
  // Sum sources only for colors the deck actually casts so "any color" dorks/altars don't dilute
  // a mono-color deck's source share via unused colors.
  const totalSources = COLORS.reduce((s, c) => (stats.pips[c] > 0 ? s + stats.sources[c] : s), 0);
  if (totalPips > 0 && totalSources > 0) {
    for (const color of COLORS) {
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

  const goldfish = simulateOpeningHands(library(view.lines), {
    rng: seededRng(`audit-${view.deck.id}`),
    trials: 500,
    freeMulligan: formatRules(view.deck.format).freeFirstMulligan,
  });

  const castability = simulateCastOnCurve(await withFeatures(db, view.lines), {
    rng: seededRng(`audit-mana-${view.deck.id}`),
    trials: 400,
    profile: deckProfile,
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
  const landTarget = resolved?.landTarget ?? formatRules(view.deck.format).suggestedLands;
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
      message: `Missing ${missingCards} played card(s) (est. ${Cents.format(Cents.of(estimatedMissingCents))}).`,
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
      problems: summarizeProblemKinds(problems.map((p) => p.kind)),
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
      strugglingSpells: castability.struggling.slice(0, 5).map((s) => ({
        ...s,
        castOnCurvePct: Math.round(s.castOnCurvePct * 100),
      })),
    },
    ownership: {
      ownedCards,
      missingCards,
      estimatedMissingCents,
    },
    goldfish,
    findings,
  };
}

function summarizeProblemKinds(kinds: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts.entries()].map(([kind, count]) => (count > 1 ? `${kind} (x${count})` : kind));
}
