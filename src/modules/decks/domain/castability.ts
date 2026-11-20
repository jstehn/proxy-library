import {
  COLORS,
  type ManaColor,
  type ManaSymbol,
  type Rng,
  randomInt,
  cardTypes,
  type CardFacts,
  type CardIdentity,
} from "@/shared/kernel";
import type { EntersTapped, TapMana } from "@/modules/catalog";
import { isPlayed, type DeckCount } from "./boards";
import { effectiveManaValue, type DeckPlan } from "./deck-profile";
import { firstUnpaidPip, isManaSymbol, parseCost, type Pip } from "./mana-payment";

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

type SimSource = Readonly<{
  isLand: true;
  tapKind: "never" | "sometimes" | "always";
  manaProduced: number;
  requiresFiveLands: boolean;
  colors: readonly ManaSymbol[];
}>;

type SimCard =
  | SimSource
  | Readonly<{
      isLand: false;
      isRamp: true;
      manaValue: number;
      manaProduced: number;
      colors: readonly ManaSymbol[];
    }>
  | Readonly<{ isLand: false; isRamp: false }>;

type SpellSpec = Readonly<{
  oracleId: string;
  name: string;
  manaValue: number;
  manaCost: string | null;
  targetTurn: number;
  pips: readonly Pip[];
}>;

function toPoolColors(producedMana: readonly string[]): ManaSymbol[] {
  return producedMana.map((color) => color.toUpperCase()).filter(isManaSymbol);
}

/**
 * Simulates `trials` opening hands + draws up to turn 7 to estimate each spell's probability
 * of being castable on curve (`turn = max(1, min(7, manaValue))`).
 * Pure and deterministic when given a seeded `Rng` (ADR 0008).
 */
export function simulateCastOnCurve(
  lines: readonly CastabilityLine[],
  options: Readonly<{ rng: Rng; trials?: number; profile?: DeckPlan | null }>,
): CastabilitySummary {
  const trials = Math.max(1, Math.min(2000, Math.round(options.trials ?? 500)));
  const { rng } = options;

  const library: SimCard[] = [];
  const spells: SpellSpec[] = [];
  const seenSpells = new Set<string>();

  for (const line of lines) {
    if (!isPlayed(line.board) || line.quantity <= 0) continue;
    // A land on the back face is a spell until it is played turned over, and it enters tapped
    // ("always"), so the simulator needs the front face apart from "has a land face".
    const types = cardTypes(line.typeLine);
    const land = types.isLandOnFront;
    const mdfcLand = types.isLand && !land;

    if (line.board === "main") {
      const produces = toPoolColors(line.producedMana ?? []);
      const manaProduced = Math.max(1, line.tapMana.amount);
      const { requiresFiveLands } = line.tapMana;
      const isManaSource = !land && !mdfcLand && line.manaValue <= 4 && line.tapMana.isSource;
      const card: SimCard =
        land || mdfcLand
          ? {
              isLand: true,
              tapKind: mdfcLand ? "always" : line.entersTapped,
              manaProduced: requiresFiveLands ? 2 : manaProduced,
              requiresFiveLands,
              colors: produces.length > 0 ? produces : ["C"],
            }
          : isManaSource
            ? {
                isLand: false,
                isRamp: true,
                manaValue: line.manaValue,
                manaProduced,
                colors: produces.length > 0 ? produces : ["C"],
              }
            : { isLand: false, isRamp: false };
      for (let i = 0; i < line.quantity; i++) library.push(card);
    }

    if (!land && !seenSpells.has(line.oracleId)) {
      seenSpells.add(line.oracleId);
      const effMv = effectiveManaValue(
        line.manaValue,
        {
          isBlitz: line.keywords?.includes("Blitz"),
          typeLine: line.typeLine,
          manaCost: line.manaCost,
          power: line.power,
          isCommander: line.board === "commander",
        },
        options.profile,
        1,
      );
      const mv = Math.max(0, Math.round(effMv));
      spells.push({
        oracleId: line.oracleId,
        name: line.name,
        manaValue: effMv,
        manaCost: line.manaCost ?? null,
        targetTurn: Math.max(1, Math.min(8, mv)),
        pips: parseCost(line.manaCost).pips,
      });
    }
  }

  if (spells.length === 0 || library.length === 0) {
    return { trials, averageCastOnCurvePct: 1, struggling: [], spells: [] };
  }

  const maxSeen = Math.min(library.length, 14); // 7 opening + 7 draws = turn 8 on the play
  const castCounts = new Int32Array(spells.length);
  const colorMissCounts: Record<ManaColor, Int32Array> = {
    W: new Int32Array(spells.length),
    U: new Int32Array(spells.length),
    B: new Int32Array(spells.length),
    R: new Int32Array(spells.length),
    G: new Int32Array(spells.length),
  };

  const deck = [...library];

  for (let t = 0; t < trials; t++) {
    // Partial Fisher-Yates for the top `maxSeen` cards
    for (let i = 0; i < maxSeen; i++) {
      const j = i + randomInt(rng, deck.length - i);
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }

    const landsByTurn: SimSource[][] = [];
    const rampByTurn: Array<readonly SimSource[]> = [];
    const currentLands: SimSource[] = [];
    const currentRamp: SimSource[] = [];
    let priorRampMana = 0;
    for (let turn = 1; turn <= 8; turn++) {
      const endIdx = Math.min(maxSeen, 6 + turn);
      const startIdx = turn === 1 ? 0 : Math.min(maxSeen, 6 + turn - 1);
      for (let k = startIdx; k < endIdx; k++) {
        const c = deck[k];
        if (c.isLand) {
          currentLands.push(c);
        } else if (
          c.isRamp &&
          turn < 8 &&
          c.manaValue <= Math.min(turn, currentLands.length + priorRampMana)
        ) {
          currentRamp.push({
            isLand: true,
            tapKind: "never",
            manaProduced: c.manaProduced,
            requiresFiveLands: false,
            colors: c.colors,
          });
          priorRampMana += c.manaProduced;
        }
      }
      landsByTurn.push([...currentLands]);
      rampByTurn.push([...currentRamp]);
    }

    for (let sIdx = 0; sIdx < spells.length; sIdx++) {
      const spell = spells[sIdx];
      const turn = spell.targetTurn;
      const seenLands = landsByTurn[turn - 1];
      const priorRamp = turn > 1 ? rampByTurn[turn - 2] : [];
      const activeLands = seenLands.slice(0, turn);
      const landCount = activeLands.length;

      const hasAlwaysUntapped = activeLands.some((l) => l.tapKind === "never");
      const hasSometimesUntapped = activeLands.some((l) => l.tapKind === "sometimes");
      const lastLandTapPenalty =
        seenLands.length >= turn && !hasAlwaysUntapped ? (hasSometimesUntapped ? 0.5 : 1) : 0;

      let landMana = 0;
      for (const l of activeLands) {
        if (l.requiresFiveLands && landCount < 5) continue;
        landMana += l.manaProduced;
      }
      landMana = Math.max(0, landMana - lastLandTapPenalty);

      const rampMana = priorRamp.reduce((sum, r) => sum + r.manaProduced, 0);
      const effectiveMana = landMana + rampMana;

      if (effectiveMana < spell.manaValue) continue;

      const unpaid = firstUnpaidPip(
        spell.pips,
        [...activeLands, ...priorRamp].map((source) => source.colors),
      );
      if (unpaid === null) {
        castCounts[sIdx] += 1;
      } else {
        const missed = unpaid.find((color): color is ManaColor => color !== "C");
        if (missed !== undefined) colorMissCounts[missed][sIdx] += 1;
      }
    }
  }

  const results: CardCastability[] = spells
    .map((spell, sIdx) => {
      const castOnCurvePct = Math.round((castCounts[sIdx] / trials) * 1000) / 1000;
      let bottleneckColor: ManaColor | null = null;
      let maxMiss = 0;
      for (const color of COLORS) {
        const misses = colorMissCounts[color][sIdx];
        if (misses > maxMiss) {
          maxMiss = misses;
          bottleneckColor = color;
        }
      }
      return {
        oracleId: spell.oracleId,
        name: spell.name,
        manaValue: spell.manaValue,
        manaCost: spell.manaCost,
        castOnCurvePct,
        bottleneckColor,
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
