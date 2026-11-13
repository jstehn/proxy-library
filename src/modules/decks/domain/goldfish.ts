import { shuffled, type Rng } from "@/shared/kernel";
import { EARLY_RAMP_MAX_MV, OPENING_HAND, type LibraryCard } from "./draws";

// Monte Carlo London-mulligan opening hand simulator (design doc 56):
// pure and deterministic via injected Rng (ADR 0008).

export type SimulateHandsOptions = Readonly<{
  rng: Rng;
  trials?: number;
  minLands?: number;
  maxLands?: number;
  requireEarlyPlay?: boolean;
  freeMulligan?: boolean;
  maxMulligans?: number;
  onTheDraw?: boolean;
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

function isEarlyPlay(card: LibraryCard): boolean {
  return !card.isLand && (card.manaValue ?? 99) <= EARLY_RAMP_MAX_MV;
}

function isEarlyRamp(card: LibraryCard): boolean {
  return isEarlyPlay(card) && card.tags.includes("ramp");
}

function isKeepable(
  hand: readonly LibraryCard[],
  minLands: number,
  maxLands: number,
  requireEarlyPlay: boolean,
): boolean {
  const lands = hand.filter((c) => c.isLand).length;
  if (lands < minLands || lands > maxLands) return false;
  if (requireEarlyPlay && !hand.some(isEarlyPlay)) return false;
  return true;
}

/**
 * London mulligan bottoming: remove `toBottom` cards while trying to keep land count
 * inside `[minLands, maxLands]` and preserving low-MV early plays.
 */
function bottomCards(
  hand: readonly LibraryCard[],
  toBottom: number,
  minLands: number,
  maxLands: number,
): LibraryCard[] {
  if (toBottom <= 0) return [...hand];
  const remaining = [...hand];
  for (let b = 0; b < toBottom && remaining.length > 0; b++) {
    const landCount = remaining.filter((c) => c.isLand).length;
    let dropIdx = -1;
    if (landCount > maxLands) {
      dropIdx = remaining.findIndex((c) => c.isLand);
    }
    if (dropIdx === -1) {
      // Drop highest-MV non-land card if we have enough lands (or if any non-land exists).
      let highestMv = -1;
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].isLand) continue;
        const mv = remaining[i].manaValue ?? 0;
        if (mv > highestMv) {
          highestMv = mv;
          dropIdx = i;
        }
      }
      if (dropIdx === -1 || (landCount > minLands && remaining.every((c) => c.isLand))) {
        dropIdx = 0;
      }
    }
    remaining.splice(dropIdx, 1);
  }
  return remaining;
}

/**
 * Simulates `trials` opening hands with London mulligans using an injected `Rng`.
 */
export function simulateOpeningHands(
  cards: readonly LibraryCard[],
  options: SimulateHandsOptions,
): GoldfishReport {
  const trials = Math.max(1, Math.min(5000, options.trials ?? 1000));
  const minLands = Math.max(0, Math.min(7, options.minLands ?? 2));
  const maxLands = Math.max(minLands, Math.min(7, options.maxLands ?? 4));
  const requireEarlyPlay = options.requireEarlyPlay ?? true;
  const freeMulligan = options.freeMulligan ?? true;
  const maxMulligans = Math.max(0, Math.min(4, options.maxMulligans ?? 2));
  const onTheDraw = options.onTheDraw ?? false;

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
      keptByMulligan: Array.from({ length: maxMulligans + 1 }, () => 0),
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
  const keptByMulligan = Array.from({ length: maxMulligans + 1 }, () => 0);
  const sampleHands: SampleHand[] = [];

  // By turn 3: draw 2 cards on the play (T2, T3), 3 cards on the draw (T1, T2, T3).
  const drawsByTurn3 = onTheDraw ? 3 : 2;

  for (let t = 0; t < trials; t++) {
    let finalHand: LibraryCard[] = [];
    let restOfLibrary: LibraryCard[] = [];
    let mulligansUsed = 0;
    let keptClean = false;

    for (let m = 0; m <= maxMulligans; m++) {
      const deck = shuffled(options.rng, cards);
      const seven = deck.slice(0, OPENING_HAND);
      const rest = deck.slice(OPENING_HAND);
      const toBottom = Math.max(0, m - (freeMulligan ? 1 : 0));
      const candidate = bottomCards(seven, toBottom, minLands, maxLands);

      if (isKeepable(candidate, minLands, maxLands, requireEarlyPlay)) {
        finalHand = candidate;
        restOfLibrary = rest;
        mulligansUsed = m;
        keptClean = true;
        break;
      }
      if (m === maxMulligans) {
        finalHand = candidate;
        restOfLibrary = rest;
        mulligansUsed = m;
      }
    }

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

    const drawnByT3 = restOfLibrary.slice(0, drawsByTurn3);
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
