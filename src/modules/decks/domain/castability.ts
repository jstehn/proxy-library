import {
  COLORS,
  type ManaColor,
  type ManaSymbol as PoolManaColor,
  type Rng,
  randomInt,
  seededRng,
} from "@/shared/kernel";
import { isPlayed, type Board } from "./boards";
import { effectiveManaValue, type DeckProfile } from "./deck-profile";
import { extractTapManaProduction, hasTapManaAbility, parseManaCost, totalMana } from "./mana";
import { tapped } from "./mana-base";
import { isLand } from "./stats";

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
  power?: string | number | null;
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
  colors: readonly PoolManaColor[];
}>;

type SimCard =
  | SimSource
  | Readonly<{
      isLand: false;
      isRamp: true;
      manaValue: number;
      manaProduced: number;
      colors: readonly PoolManaColor[];
    }>
  | Readonly<{ isLand: false; isRamp: false }>;

type SpellSpec = Readonly<{
  oracleId: string;
  name: string;
  manaValue: number;
  manaCost: string | null;
  targetTurn: number;
  /** Each entry is a list of acceptable colors for that pip (length 1 = strict, length 2+ = hybrid). */
  pipOptions: ReadonlyArray<readonly PoolManaColor[]>;
}>;

function toPoolColors(producedMana: readonly string[]): PoolManaColor[] {
  const valid = new Set<string>(["W", "U", "B", "R", "G", "C"]);
  const out: PoolManaColor[] = [];
  for (const c of producedMana) {
    const up = c.toUpperCase();
    if (valid.has(up)) out.push(up as PoolManaColor);
  }
  return out;
}

function hasBackFaceLand(typeLine: string): boolean {
  const faces = typeLine.split(" // ");
  return faces.length > 1 && /\bLand\b/i.test(faces[1] ?? "");
}

function buildPipOptions(manaCost: string | null): ReadonlyArray<readonly PoolManaColor[]> {
  const parsed = parseManaCost(manaCost, 0);
  const options: PoolManaColor[][] = [];
  for (const color of ["W", "U", "B", "R", "G", "C"] as const) {
    for (let i = 0; i < parsed.pips[color]; i++) {
      options.push([color]);
    }
  }
  for (const hybrid of parsed.hybridPips) {
    options.push([...hybrid]);
  }
  // Phyrexian pips are payable with 2 life so they don't block castability on color
  return options;
}

/**
 * Checks whether `sources` can pay `pipOptions` (strict + hybrid + colorless).
 * Returns `null` if all pips are paid, or the first missing WUBRG color pip.
 */
function missingPip(
  sources: readonly SimSource[],
  pipOptions: ReadonlyArray<readonly PoolManaColor[]>,
): ManaColor | null {
  if (pipOptions.length === 0) return null;
  // Prefer sources with fewer produced colors first so monocolor lands are consumed before duals.
  const ordered = [...sources].sort((a, b) => a.colors.length - b.colors.length);
  const used = new Array<boolean>(ordered.length).fill(false);

  // Pay strict single-color pips before flexible hybrid pips
  const sortedPips = [...pipOptions].sort((a, b) => a.length - b.length);
  for (const choices of sortedPips) {
    let found = -1;
    for (let i = 0; i < ordered.length; i++) {
      if (used[i]) continue;
      if (choices.some((c) => ordered[i].colors.includes(c))) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      const wubrg = choices.find((c): c is ManaColor => c !== "C");
      return wubrg ?? null;
    }
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
  options: Readonly<{ rng?: Rng; trials?: number; profile?: DeckProfile | null }> = {},
): CastabilitySummary {
  const trials = Math.max(1, Math.min(2000, Math.round(options.trials ?? 500)));
  const rng = options.rng ?? seededRng("cast-on-curve");

  const library: SimCard[] = [];
  const spells: SpellSpec[] = [];
  const seenSpells = new Set<string>();

  for (const line of lines) {
    if (!isPlayed(line.board) || line.quantity <= 0) continue;
    const land = isLand(line.typeLine);
    const mdfcLand = !land && hasBackFaceLand(line.typeLine);

    if (line.board === "main") {
      const produces = toPoolColors(line.producedMana ?? []);
      const tapPool = extractTapManaProduction({
        typeLine: line.typeLine,
        text: line.text,
        producedMana: line.producedMana,
        isLand: land || mdfcLand,
      });
      const manaProduced = Math.max(1, totalMana(tapPool));
      const requiresFiveLands = /activate only if you control five or more lands/i.test(
        line.text ?? "",
      );
      const isManaSource = !land && !mdfcLand && line.manaValue <= 4 && hasTapManaAbility(line);
      const card: SimCard =
        land || mdfcLand
          ? {
              isLand: true,
              tapKind: mdfcLand ? "always" : tapped(line.text ?? ""),
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
          oracleText: line.text,
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
        pipOptions: buildPipOptions(line.manaCost ?? null),
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

      const missed = missingPip([...activeLands, ...priorRamp], spell.pipOptions);
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
