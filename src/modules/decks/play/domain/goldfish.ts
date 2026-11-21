import type { Rng } from "@/shared/kernel";
import {
  COMMANDER_KEEP,
  drawsByTurn,
  isEarlyPlay,
  isEarlyRamp,
  MAX_MULLIGANS,
  playOpening,
} from "./opening-hand/hand";
import { OPENING_HAND, type LibraryCard } from "./opening-hand/library";

// Monte Carlo London-mulligan opening hand simulator (design doc 56):
// pure and deterministic via injected Rng (ADR 0008).

export type SimulateHandsOptions = Readonly<{
  rng: Rng;
  trials?: number;
  freeMulligan?: boolean;
}>;

export type SampleHand = Readonly<{
  mulligans: number;
  keptCount: number;
  lands: number;
  cards: readonly string[];
}>;

export type GoldfishReport = Readonly<{
  trials: number;
  librarySize: number;
  keepableRatePct: number;
  avgKeptLands: number;
  avgKeptSpells: number;
  earlyPlayInHandPct: number;
  earlyRampInHandPct: number;
  turn3LandDropPct: number;
  manaScrewPct: number;
  manaFloodPct: number;
  keptByMulligan: readonly number[];
  sampleHands: readonly SampleHand[];
}>;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(count: number, total: number): number {
  return total === 0 ? 0 : round1((count / total) * 100);
}

/**
 * Simulates `trials` opening hands with London mulligans using an injected `Rng`.
 */
export function simulateOpeningHands(
  cards: readonly LibraryCard[],
  options: SimulateHandsOptions,
): GoldfishReport {
  const trials = Math.max(1, Math.min(5000, options.trials ?? 1000));
  const freeMulligan = options.freeMulligan ?? true;

  if (cards.length < OPENING_HAND) {
    return {
      trials: 0,
      librarySize: cards.length,
      keepableRatePct: 0,
      avgKeptLands: 0,
      avgKeptSpells: 0,
      earlyPlayInHandPct: 0,
      earlyRampInHandPct: 0,
      turn3LandDropPct: 0,
      manaScrewPct: 0,
      manaFloodPct: 0,
      keptByMulligan: Array.from({ length: MAX_MULLIGANS + 1 }, () => 0),
      sampleHands: [],
    };
  }

  let keepableCount = 0;
  let totalKeptLands = 0;
  let totalKeptSpells = 0;
  let earlyPlayCount = 0;
  let earlyRampCount = 0;
  let turn3LandCount = 0;
  let manaScrewCount = 0;
  let manaFloodCount = 0;
  const keptByMulligan = Array.from({ length: MAX_MULLIGANS + 1 }, () => 0);
  const sampleHands: SampleHand[] = [];

  for (let t = 0; t < trials; t++) {
    const {
      hand: finalHand,
      library: restOfLibrary,
      mulligans: mulligansUsed,
      keptClean,
    } = playOpening(cards, options.rng, {
      policy: COMMANDER_KEEP,
      freeMulligan,
      maxMulligans: MAX_MULLIGANS,
    });

    if (keptClean) keepableCount += 1;
    keptByMulligan[mulligansUsed] += 1;

    const lands = finalHand.filter((c) => c.isLand).length;
    const spells = finalHand.length - lands;
    totalKeptLands += lands;
    totalKeptSpells += spells;
    if (lands <= 1) manaScrewCount += 1;
    if (lands >= 5) manaFloodCount += 1;
    if (finalHand.some(isEarlyPlay)) earlyPlayCount += 1;
    if (finalHand.some(isEarlyRamp)) earlyRampCount += 1;

    const drawnByT3 = restOfLibrary.slice(0, drawsByTurn(3, false));
    const totalLandsByT3 = lands + drawnByT3.filter((c) => c.isLand).length;
    if (totalLandsByT3 >= 3) turn3LandCount += 1;

    if (sampleHands.length < 3) {
      sampleHands.push({
        mulligans: mulligansUsed,
        keptCount: finalHand.length,
        lands,
        cards: finalHand.map((c) => c.name),
      });
    }
  }

  return {
    trials,
    librarySize: cards.length,
    keepableRatePct: pct(keepableCount, trials),
    avgKeptLands: round1(totalKeptLands / trials),
    avgKeptSpells: round1(totalKeptSpells / trials),
    earlyPlayInHandPct: pct(earlyPlayCount, trials),
    earlyRampInHandPct: pct(earlyRampCount, trials),
    turn3LandDropPct: pct(turn3LandCount, trials),
    manaScrewPct: pct(manaScrewCount, trials),
    manaFloodPct: pct(manaFloodCount, trials),
    keptByMulligan,
    sampleHands,
  };
}
