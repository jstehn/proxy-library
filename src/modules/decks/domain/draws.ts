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
  tags: readonly Tag[];
}>;

export const OPENING_HAND = 7;

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

/** Cards seen by a turn: the opening hand, one per draw step, and one more on the draw. */
function cardsSeen(turn: number, onTheDraw: boolean): number {
  return OPENING_HAND + turn - 1 + (onTheDraw ? 1 : 0);
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
