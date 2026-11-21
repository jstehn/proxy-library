import { type Rng } from "@/shared/kernel";
import {
  type ManaColor,
  cardTypes,
  type CardFacts,
  type CardIdentity,
  type Tag,
} from "@/shared/mtg";
import type { CardFeatures, EntersTapped, TapMana } from "@/modules/catalog";
import {
  isPlayed,
  type DeckCount,
  effectiveManaValue,
  type DeckPlan,
  parseCost,
  type Pip,
} from "@/modules/decks/core/client";
import { simulateCasting } from "./cast-by-turn";
import { COMMANDER_KEEP, type MulliganRule } from "./opening-hand/hand";
import { library } from "./opening-hand/library";

export type CastabilityLine = DeckCount &
  Pick<CardIdentity, "oracleId"> &
  Pick<CardFacts, "name" | "typeLine" | "manaValue"> &
  Readonly<{
    manaCost?: string | null;
    producedMana?: readonly string[];
    /** Scryfall's keyword list ("Blitz" makes the blitz cost reducers apply). */
    keywords?: readonly string[];
    power?: string | number | null;
    /** What the card does when tapped for mana: the catalog's card features (design doc 66). */
    tapMana: TapMana;
    /** Whether a land enters tapped: from the card features too. */
    entersTapped: EntersTapped;
    /** The card's role tags and land fetch (card features): a ramp spell can fetch a land. */
    roles?: readonly Tag[];
    landFetch?: CardFeatures["landFetch"];
  }>;

export type CardCastability = Readonly<{
  oracleId: string;
  name: string;
  manaValue: number;
  manaCost: string | null;
  /** Probability in [0, 1] of casting on turn max(1, min(7, manaValue)). */
  castOnCurvePct: number;
  /** Most frequent missing color pip when total mana was sufficient, or null. */
  bottleneckColor: ManaColor | null;
}>;

export type CastabilitySummary = Readonly<{
  trials: number;
  /** Average cast-on-curve probability across all counted non-land spells. */
  averageCastOnCurvePct: number;
  /** Spells with castOnCurvePct < 0.75, sorted lowest castOnCurvePct first. */
  struggling: readonly CardCastability[];
  /** All evaluated non-land spells, sorted lowest castOnCurvePct first. */
  spells: readonly CardCastability[];
}>;

type SpellSpec = Readonly<{
  oracleId: string;
  name: string;
  typeLine: string;
  manaValue: number;
  manaCost: string | null;
  targetTurn: number;
  pips: readonly Pip[];
}>;

/** No mulligan: the question is what the cards you see can pay for. */
const NO_MULLIGAN: MulliganRule = { policy: COMMANDER_KEEP, freeMulligan: false, maxMulligans: 0 };
const LAST_CURVE_TURN = 8;

/**
 * Estimates each spell's probability of being castable on curve (`turn = max(1, min(8, manaValue))`)
 * by simulating `trials` games with the one cast simulator, mana only (the card need not be drawn).
 * Pure and deterministic when given a seeded `Rng` (ADR 0008).
 */
export function simulateCastOnCurve(
  lines: readonly CastabilityLine[],
  options: Readonly<{ rng: Rng; trials?: number; profile?: DeckPlan | null }>,
): CastabilitySummary {
  const trials = Math.max(1, Math.min(2000, Math.round(options.trials ?? 500)));
  const cards = library(lines.map((line) => ({ ...line, printingId: line.oracleId })));
  const spells = spellsOf(lines, options.profile);
  if (spells.length === 0 || cards.length === 0) {
    return { trials, averageCastOnCurvePct: 1, struggling: [], spells: [] };
  }

  const { curves } = simulateCasting(
    cards,
    spells.map((spell) => ({ ...spell, mustDraw: false, lastTurn: spell.targetTurn })),
    {
      rng: options.rng,
      runs: trials,
      onTheDraw: false,
      lastTurn: LAST_CURVE_TURN,
      rule: NO_MULLIGAN,
    },
  );

  const results: CardCastability[] = spells
    .map((spell, index) => {
      const curve = curves[index];
      // The most common missing colour (a missing colourless source is no colour to fix).
      const missingColor = curve.misses
        .map((miss) => miss.reason.split(":")[1])
        .find((color): color is ManaColor => color !== undefined && color !== "C");
      return {
        oracleId: spell.oracleId,
        name: spell.name,
        manaValue: spell.manaValue,
        manaCost: spell.manaCost,
        castOnCurvePct: curve.byTurn[spell.targetTurn - 1],
        bottleneckColor: missingColor ?? null,
      };
    })
    .sort((a, b) => a.castOnCurvePct - b.castOnCurvePct || a.name.localeCompare(b.name));

  const avg =
    Math.round((results.reduce((sum, r) => sum + r.castOnCurvePct, 0) / results.length) * 1000) /
    1000;

  return {
    trials,
    averageCastOnCurvePct: avg,
    struggling: results.filter((r) => r.castOnCurvePct < 0.75),
    spells: results,
  };
}

/** Every played card that is not a land on its front face, once, with the turn to cast it by. */
function spellsOf(lines: readonly CastabilityLine[], profile?: DeckPlan | null): SpellSpec[] {
  const seen = new Set<string>();
  const spells: SpellSpec[] = [];
  for (const line of lines) {
    // A land on the back face is a spell until it is played turned over.
    if (!isPlayed(line.board) || line.quantity <= 0) continue;
    if (cardTypes(line.typeLine).isLandOnFront || seen.has(line.oracleId)) continue;
    seen.add(line.oracleId);
    const manaValue = effectiveManaValue(
      line.manaValue,
      {
        isBlitz: line.keywords?.includes("Blitz"),
        typeLine: line.typeLine,
        manaCost: line.manaCost,
        power: line.power,
        isCommander: line.board === "commander",
      },
      profile,
      1,
    );
    spells.push({
      oracleId: line.oracleId,
      name: line.name,
      typeLine: line.typeLine,
      manaValue,
      manaCost: line.manaCost ?? null,
      targetTurn: Math.max(1, Math.min(LAST_CURVE_TURN, Math.round(manaValue))),
      pips: parseCost(line.manaCost).pips,
    });
  }
  return spells;
}
