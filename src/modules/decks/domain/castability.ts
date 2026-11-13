import { randomInt, seededRng, type Rng } from "@/shared/kernel";
import { isPlayed, type Board } from "./boards";
import { tapped } from "./mana-base";
import { colorPips, isLand, MANA_COLORS, type ManaColor } from "./stats";

export type CastabilityLine = Readonly<{
  oracleId: string;
  name: string;
  board: Board;
  quantity: number;
  typeLine: string;
  manaValue: number;
  manaCost?: string | null;
  producedMana?: readonly string[];
  text?: string;
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

type SimLand = Readonly<{
  isLand: true;
  untappedOnPlay: boolean;
  colors: readonly ManaColor[];
}>;

type SimCard = SimLand | Readonly<{ isLand: false }>;

type SpellSpec = Readonly<{
  oracleId: string;
  name: string;
  manaValue: number;
  manaCost: string | null;
  targetTurn: number;
  pips: readonly ManaColor[];
}>;

function toColors(producedMana: readonly string[]): ManaColor[] {
  const out: ManaColor[] = [];
  for (const c of producedMana) {
    if ((MANA_COLORS as readonly string[]).includes(c)) {
      out.push(c as ManaColor);
    }
  }
  return out;
}

function expandPips(manaCost: string | null): ManaColor[] {
  const counts = colorPips(manaCost);
  const pips: ManaColor[] = [];
  for (const color of MANA_COLORS) {
    for (let i = 0; i < counts[color]; i++) pips.push(color);
  }
  return pips;
}

/**
 * Checks whether `lands` (up to `maxLands` tapped for mana) can pay `pips`.
 * Returns `null` if all pips are paid, or the first missing color pip.
 */
function missingPip(lands: readonly SimLand[], pips: readonly ManaColor[]): ManaColor | null {
  if (pips.length === 0) return null;
  // Prefer lands with fewer produced colors first so monocolor lands are consumed before duals.
  const ordered = [...lands].sort((a, b) => a.colors.length - b.colors.length);
  const used = new Array<boolean>(ordered.length).fill(false);

  for (const pip of pips) {
    let found = -1;
    for (let i = 0; i < ordered.length; i++) {
      if (!used[i] && ordered[i].colors.includes(pip)) {
        found = i;
        break;
      }
    }
    if (found === -1) return pip;
    used[found] = true;
  }
  return null;
}

/**
 * Simulates `trials` opening hands + draws up to turn 7 to estimate each spell's probability
 * of being castable on curve (`turn = max(1, min(7, manaValue))`).
 * Pure and deterministic when given a seeded `Rng` (ADR 0008).
 */
export function simulateCastOnCurve(
  lines: readonly CastabilityLine[],
  options: Readonly<{ rng?: Rng; trials?: number }> = {},
): CastabilitySummary {
  const trials = Math.max(1, Math.min(2000, Math.round(options.trials ?? 500)));
  const rng = options.rng ?? seededRng("cast-on-curve");

  const library: SimCard[] = [];
  const spells: SpellSpec[] = [];
  const seenSpells = new Set<string>();

  for (const line of lines) {
    if (!isPlayed(line.board) || line.quantity <= 0) continue;
    const land = isLand(line.typeLine);

    if (line.board === "main") {
      const card: SimCard = land
        ? {
            isLand: true,
            untappedOnPlay: tapped(line.text ?? "") !== "always",
            colors: toColors(line.producedMana ?? []),
          }
        : { isLand: false };
      for (let i = 0; i < line.quantity; i++) library.push(card);
    }

    if (!land && !seenSpells.has(line.oracleId)) {
      seenSpells.add(line.oracleId);
      const mv = Math.max(0, Math.round(line.manaValue));
      spells.push({
        oracleId: line.oracleId,
        name: line.name,
        manaValue: line.manaValue,
        manaCost: line.manaCost ?? null,
        targetTurn: Math.max(1, Math.min(7, mv)),
        pips: expandPips(line.manaCost ?? null),
      });
    }
  }

  if (spells.length === 0 || library.length === 0) {
    return { trials, averageCastOnCurvePct: 1, struggling: [], spells: [] };
  }

  const maxSeen = Math.min(library.length, 13); // 7 opening + 6 draws = turn 7 on the play
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

    // Precompute seen lands by turn 1..7
    const landsByTurn: SimLand[][] = [];
    const currentLands: SimLand[] = [];
    for (let turn = 1; turn <= 7; turn++) {
      const endIdx = Math.min(maxSeen, 6 + turn);
      const startIdx = turn === 1 ? 0 : Math.min(maxSeen, 6 + turn - 1);
      for (let k = startIdx; k < endIdx; k++) {
        const c = deck[k];
        if (c.isLand) currentLands.push(c);
      }
      landsByTurn.push([...currentLands]);
    }

    for (let sIdx = 0; sIdx < spells.length; sIdx++) {
      const spell = spells[sIdx];
      const turn = spell.targetTurn;
      const seenLands = landsByTurn[turn - 1];
      const hasUntapped = seenLands.some((l) => l.untappedOnPlay);
      const effectiveMana =
        seenLands.length >= turn ? (hasUntapped ? turn : Math.max(0, turn - 1)) : seenLands.length;

      if (effectiveMana < spell.manaValue) continue;

      const missed = missingPip(seenLands, spell.pips);
      if (missed === null) {
        castCounts[sIdx] += 1;
      } else {
        colorMissCounts[missed][sIdx] += 1;
      }
    }
  }

  const results: CardCastability[] = spells
    .map((spell, sIdx) => {
      const castOnCurvePct = Math.round((castCounts[sIdx] / trials) * 1000) / 1000;
      let bottleneckColor: ManaColor | null = null;
      let maxMiss = 0;
      for (const color of MANA_COLORS) {
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
