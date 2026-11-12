import { cardTags, type Tag } from "@/shared/card-search";
import { shuffled, type Rng } from "@/shared/kernel";
import type { Board } from "./deck";
import { isLand } from "./stats";

// The draw simulator (design doc 19, section 3.4): test hands, London mulligans and the exact
// odds of drawing what the deck needs. Pure: the browser passes in an Rng seeded by the server
// (ADR 0008's implementation note), so nothing here decides anything that matters.

/** What the simulator needs from a deck line. */
export type DrawLine = Readonly<{
  oracleId: string;
  name: string;
  printingId: string;
  board: Board;
  quantity: number;
  typeLine: string;
  manaValue?: number;
  text?: string;
  producedMana?: readonly string[];
}>;

/** One copy of a card in the library. */
export type LibraryCard = Readonly<{
  /** Tells copies apart: "oracleId#2". */
  key: string;
  oracleId: string;
  name: string;
  printingId: string;
  isLand: boolean;
  manaValue?: number;
  tags: readonly Tag[];
}>;

export const OPENING_HAND = 7;

/** Maximum mana value of a non-land ramp spell counted as castable by turn 3 (design doc 43). */
export const EARLY_RAMP_MAX_MV = 3;

/** The cards you draw from: one entry per copy in the main deck. Commanders start in the
 * command zone, and the sideboard stays out (invariant 5). */
export function library(lines: readonly DrawLine[]): LibraryCard[] {
  return lines
    .filter((line) => line.board === "main")
    .flatMap((line) => {
      const tags = cardTags({
        typeLine: line.typeLine,
        text: line.text ?? "",
        producedMana: line.producedMana,
      });
      return Array.from({ length: line.quantity }, (_, copy) => ({
        key: `${line.oracleId}#${copy + 1}`,
        oracleId: line.oracleId,
        name: line.name,
        printingId: line.printingId,
        isLand: isLand(line.typeLine),
        ...(line.manaValue !== undefined ? { manaValue: line.manaValue } : {}),
        tags,
      }));
    });
}

/** A test game: the library (top first), the hand, and where the mulligan stands. */
export type TestHand = Readonly<{
  library: readonly LibraryCard[];
  hand: readonly LibraryCard[];
  /** Mulligans taken this game. */
  mulligans: number;
  /** Cards still to put on the bottom (London mulligan). 0 once the hand is settled. */
  toBottom: number;
  /** Draw steps taken: 0 until the first "draw". */
  turn: number;
  /** Whether the first mulligan is free (Commander's multiplayer rule, CR 103.5c). */
  freeMulligan: boolean;
}>;

export type TestHandEvent =
  | Readonly<{ kind: "newHand"; rng: Rng }>
  | Readonly<{ kind: "mulligan"; rng: Rng }>
  | Readonly<{ kind: "bottom"; key: string }>
  | Readonly<{ kind: "draw" }>;

/** Shuffles the cards and deals an opening hand. */
export function startHand(
  cards: readonly LibraryCard[],
  rng: Rng,
  freeMulligan: boolean,
  mulligans = 0,
): TestHand {
  const deck = shuffled(rng, cards);
  return {
    library: deck.slice(OPENING_HAND),
    hand: deck.slice(0, OPENING_HAND),
    mulligans,
    toBottom: Math.max(0, mulligans - (freeMulligan ? 1 : 0)),
    turn: 0,
    freeMulligan,
  };
}

/** The next state of a test game (section 7's table). Events that don't apply change nothing. */
export function nextHand(state: TestHand, event: TestHandEvent): TestHand {
  switch (event.kind) {
    case "newHand":
      return startHand(everyCard(state), event.rng, state.freeMulligan);
    case "mulligan":
      if (state.turn > 0 || state.toBottom > 0) return state;
      return startHand(everyCard(state), event.rng, state.freeMulligan, state.mulligans + 1);
    case "bottom": {
      const card = state.hand.find((candidate) => candidate.key === event.key);
      if (state.toBottom === 0 || card === undefined) return state;
      return {
        ...state,
        hand: state.hand.filter((candidate) => candidate !== card),
        library: [...state.library, card],
        toBottom: state.toBottom - 1,
      };
    }
    case "draw": {
      const [top, ...rest] = state.library;
      if (state.toBottom > 0 || top === undefined) return state;
      return { ...state, hand: [...state.hand, top], library: rest, turn: state.turn + 1 };
    }
  }
}

function everyCard(state: TestHand): LibraryCard[] {
  return [...state.hand, ...state.library];
}

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
  return OPENING_HAND + Math.max(1, turn) - 1 + (onTheDraw ? 1 : 0);
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

/** Exact hypergeometric probability of drawing at least `atLeast` of `successes` by `turn`. */
export function chanceByTurn(
  population: number,
  successes: number,
  turn: number,
  onTheDraw: boolean,
  atLeast = 1,
): number {
  if (population <= 0) return atLeast <= 0 ? 1 : 0;
  return hypergeometricAtLeast(population, successes, cardsSeen(turn, onTheDraw), atLeast);
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
  const earlyRamp = cards.filter(
    (card) =>
      !card.isLand && card.tags.includes("ramp") && (card.manaValue ?? 0) <= EARLY_RAMP_MAX_MV,
  ).length;
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
