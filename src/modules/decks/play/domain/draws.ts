import type { Tag } from "@/shared/mtg";
import { drawsByTurn, isEarlyRamp } from "./opening-hand/hand";
import { OPENING_HAND, type LibraryCard } from "./opening-hand/library";

// The exact odds of drawing what the deck needs (design doc 19, section 3.4): the hypergeometric
// distribution, no dice. Dealing and mulligans live in `opening-hand/`.

/** ln(n!) for n = 0…size, built once per call: sums of logs stay exact enough and never overflow. */
function logFactorials(size: number): number[] {
  const table = [0];
  for (let n = 1; n <= size; n++) table.push(table[n - 1] + Math.log(n));
  return table;
}

/**
 * The chance of drawing at least `atLeast` of the `successes` cards when drawing `draws` cards
 * from `population` without putting any back: the hypergeometric distribution (invariant 7).
 */
export function hypergeometricAtLeast(
  population: number,
  successes: number,
  draws: number,
  atLeast: number,
): number {
  if (atLeast <= 0) return 1;
  const drawn = Math.min(draws, population);
  const most = Math.min(successes, drawn);
  if (atLeast > most) return 0;
  const lnFactorial = logFactorials(population);
  const lnChoose = (n: number, k: number) => lnFactorial[n] - lnFactorial[k] - lnFactorial[n - k];
  const lnAllHands = lnChoose(population, drawn);
  let chance = 0;
  // Hands with exactly `hits` successes: choose the hits, then choose the rest from the others.
  for (let hits = atLeast; hits <= most; hits++) {
    const misses = drawn - hits;
    if (misses > population - successes) continue;
    chance += Math.exp(
      lnChoose(successes, hits) + lnChoose(population - successes, misses) - lnAllHands,
    );
  }
  return Math.min(1, chance);
}

export type OddsRow = Readonly<{ label: string; chance: number }>;

export type LandDropOdds = Readonly<{
  turn: 1 | 2 | 3 | 4 | 5;
  cardsSeen: number;
  targetLands: number;
  chance: number;
}>;

export type OpeningHandOdds = Readonly<{
  librarySize: number;
  lands: number;
  ramp: number;
  earlyRamp: number;
  onTheDraw: boolean;
  freeMulligan: boolean;
  opening: Readonly<{
    tooFewLands: number;
    playableLands: number;
    tooManyLands: number;
    atLeastOneEarlyRamp: number;
    /** Chance of seeing 2–5 lands across the opening 7 or 1st London mulligan hand. */
    playableAfterFirstMulligan: number;
  }>;
  landDrops: readonly LandDropOdds[];
  rampByTurn3: Readonly<{
    cardsSeen: number;
    atLeastOneEarlyRamp: number;
    atLeastOneAnyRamp: number;
    twoLandsAndEarlyRamp: number;
    threeLandsAndEarlyRamp: number;
  }>;
  roles: readonly OddsRow[];
}>;

/** Cards seen by a turn: the opening hand, one per draw step, and one more on the draw. */
function cardsSeen(turn: number, onTheDraw: boolean): number {
  return OPENING_HAND + drawsByTurn(turn, onTheDraw);
}

/**
 * Exact multivariate hypergeometric probability of drawing at least `minA` cards from disjoint
 * group A and at least `minB` cards from disjoint group B when drawing `draws` from `population`
 * without replacement (`groupA + groupB <= population`).
 */
export function hypergeometricAtLeast2Groups(
  population: number,
  groupA: number,
  groupB: number,
  draws: number,
  minA: number,
  minB: number,
): number {
  if (population <= 0) return minA <= 0 && minB <= 0 ? 1 : 0;
  const drawn = Math.min(draws, population);
  const clampedA = Math.max(0, groupA);
  const clampedB = Math.max(0, groupB);
  const others = Math.max(0, population - clampedA - clampedB);
  const maxA = Math.min(clampedA, drawn);
  const reqA = Math.max(0, minA);
  const reqB = Math.max(0, minB);
  if (reqA + reqB > drawn || reqA > clampedA || reqB > clampedB) return 0;

  const lnFactorial = logFactorials(population);
  const lnChoose = (n: number, k: number) => lnFactorial[n] - lnFactorial[k] - lnFactorial[n - k];
  const lnAllHands = lnChoose(population, drawn);

  let chance = 0;
  for (let a = reqA; a <= maxA; a++) {
    const maxB = Math.min(clampedB, drawn - a);
    for (let b = reqB; b <= maxB; b++) {
      const c = drawn - a - b;
      if (c > others) continue;
      chance += Math.exp(
        lnChoose(clampedA, a) + lnChoose(clampedB, b) + lnChoose(others, c) - lnAllHands,
      );
    }
  }
  return Math.max(0, Math.min(1, chance));
}

/** Full opening-hand, land-drop (turns 1–5), turn-3 ramp, and role odds (design doc 43). */
export function openingHandOdds(
  cards: readonly LibraryCard[],
  options: Readonly<{ onTheDraw?: boolean; freeMulligan?: boolean }> = {},
): OpeningHandOdds | null {
  const population = cards.length;
  if (population === 0) return null;

  const onTheDraw = options.onTheDraw ?? false;
  const freeMulligan = options.freeMulligan ?? false;
  const lands = cards.filter((card) => card.isLand).length;
  const ramp = cards.filter((card) => card.tags.includes("ramp")).length;
  const earlyRamp = cards.filter(isEarlyRamp).length;
  const atLeast = (successes: number, draws: number, count: number) =>
    hypergeometricAtLeast(population, successes, draws, count);

  const twoPlusOpening = atLeast(lands, OPENING_HAND, 2);
  const sixPlusOpening = atLeast(lands, OPENING_HAND, 6);
  const playableLands = Math.max(0, twoPlusOpening - sixPlusOpening);
  const tooManyLands = Math.max(0, sixPlusOpening);
  const tooFewLands = Math.max(0, 1 - twoPlusOpening);
  const playableAfterFirstMulligan = Math.min(1, 1 - (1 - playableLands) ** 2);

  const turns = [1, 2, 3, 4, 5] as const;
  const landDrops: LandDropOdds[] = turns.map((turn) => {
    const seen = cardsSeen(turn, onTheDraw);
    return {
      turn,
      cardsSeen: seen,
      targetLands: turn,
      chance: atLeast(lands, seen, turn),
    };
  });

  const t3Seen = cardsSeen(3, onTheDraw);

  return {
    librarySize: population,
    lands,
    ramp,
    earlyRamp,
    onTheDraw,
    freeMulligan,
    opening: {
      tooFewLands,
      playableLands,
      tooManyLands,
      atLeastOneEarlyRamp: atLeast(earlyRamp, OPENING_HAND, 1),
      playableAfterFirstMulligan,
    },
    landDrops,
    rampByTurn3: {
      cardsSeen: t3Seen,
      atLeastOneEarlyRamp: atLeast(earlyRamp, t3Seen, 1),
      atLeastOneAnyRamp: atLeast(ramp, t3Seen, 1),
      twoLandsAndEarlyRamp: hypergeometricAtLeast2Groups(
        population,
        lands,
        earlyRamp,
        t3Seen,
        2,
        1,
      ),
      threeLandsAndEarlyRamp: hypergeometricAtLeast2Groups(
        population,
        lands,
        earlyRamp,
        t3Seen,
        3,
        1,
      ),
    },
    roles: deckOdds(cards, onTheDraw),
  };
}

/** The odds table the test hand panel shows (design doc 19, section 5.2). */
export function deckOdds(cards: readonly LibraryCard[], onTheDraw: boolean): OddsRow[] {
  const population = cards.length;
  if (population === 0) return [];
  const lands = cards.filter((card) => card.isLand).length;
  const withTag = (tag: Tag) => cards.filter((card) => card.tags.includes(tag)).length;
  const atLeast = (successes: number, draws: number, count: number) =>
    hypergeometricAtLeast(population, successes, draws, count);

  const rows: OddsRow[] = [
    {
      label: "2–5 lands in the opening hand",
      chance: atLeast(lands, OPENING_HAND, 2) - atLeast(lands, OPENING_HAND, 6),
    },
    { label: "3 lands by turn 3", chance: atLeast(lands, cardsSeen(3, onTheDraw), 3) },
    { label: "4 lands by turn 4", chance: atLeast(lands, cardsSeen(4, onTheDraw), 4) },
  ];
  const roles: ReadonlyArray<readonly [Tag, string, number]> = [
    ["ramp", "A ramp card by turn 2", 2],
    ["draw", "Card draw by turn 4", 4],
    ["removal", "Removal by turn 4", 4],
  ];
  for (const [tag, label, turn] of roles) {
    const count = withTag(tag);
    if (count > 0) rows.push({ label, chance: atLeast(count, cardsSeen(turn, onTheDraw), 1) });
  }
  return rows;
}
