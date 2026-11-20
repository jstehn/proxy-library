import { type Rng, shuffled } from "@/shared/kernel";
import { EARLY_RAMP_MAX_MV, OPENING_HAND, type LibraryCard } from "./library";

// The one opening-hand engine (P15): dealing, the London mulligan, bottoming, the keep rule and
// drawing. The test hand, the odds simulator, `draw_sample` and the scorecard all call it.
// Pure and stateless: every function takes its state and an injected Rng and returns a new state
// (ADR 0008), so a seeded run is repeatable.

/** What a keepable hand looks like. */
export type KeepPolicy = Readonly<{
  minLands: number;
  maxLands: number;
  /** Whether the hand needs a spell it can cast by turn 3. */
  requireEarlyPlay: boolean;
}>;

/** Commander's rule of thumb: 2 to 4 lands and something to cast early. */
export const COMMANDER_KEEP: KeepPolicy = { minLands: 2, maxLands: 4, requireEarlyPlay: true };

export type MulliganRule = Readonly<{
  policy: KeepPolicy;
  /** Whether the first mulligan is free (Commander's multiplayer rule, CR 103.5c). */
  freeMulligan: boolean;
  /** After this many mulligans the hand is kept, keepable or not. */
  maxMulligans: number;
}>;

/** A game: the library (top first), the hand, and where the mulligan stands. */
export type HandState = Readonly<{
  library: readonly LibraryCard[];
  hand: readonly LibraryCard[];
  /** Mulligans taken this game. */
  mulligans: number;
  /** Cards still to put on the bottom (London mulligan). 0 once the hand is settled. */
  toBottom: number;
  /** Draw steps taken: 0 until the first draw. */
  turn: number;
  freeMulligan: boolean;
}>;

/** A hand a policy settled on: `keptClean` is false when the mulligans ran out first. */
export type Opening = HandState & Readonly<{ keptClean: boolean }>;

/** A spell (not a land) cheap enough to cast by turn 3. */
export function isEarlyPlay(card: LibraryCard): boolean {
  return !card.isLand && (card.manaValue ?? 99) <= EARLY_RAMP_MAX_MV;
}

export function isEarlyRamp(card: LibraryCard): boolean {
  return isEarlyPlay(card) && card.tags.includes("ramp");
}

export function isKeepable(hand: readonly LibraryCard[], policy: KeepPolicy): boolean {
  const lands = hand.filter((card) => card.isLand).length;
  if (lands < policy.minLands || lands > policy.maxLands) return false;
  return !policy.requireEarlyPlay || hand.some(isEarlyPlay);
}

/** The card the policy puts on the bottom: a land when there are too many, else the dearest spell. */
export function chooseBottom(hand: readonly LibraryCard[], policy: KeepPolicy): LibraryCard {
  const lands = hand.filter((card) => card.isLand);
  if (lands.length > policy.maxLands) return lands[0];
  const spells = hand.filter((card) => !card.isLand);
  return spells.reduce(
    (best, card) => ((card.manaValue ?? 0) > (best.manaValue ?? 0) ? card : best),
    spells[0] ?? hand[0],
  );
}

/** Shuffles the cards and deals a hand; a mulligan leaves cards to put on the bottom. */
export function dealHand(
  cards: readonly LibraryCard[],
  rng: Rng,
  freeMulligan: boolean,
  mulligans = 0,
): HandState {
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

/** Puts one card from the hand on the bottom of the library. */
export function bottomCard(state: HandState, card: LibraryCard): HandState {
  return {
    ...state,
    hand: state.hand.filter((candidate) => candidate !== card),
    library: [...state.library, card],
    toBottom: state.toBottom - 1,
  };
}

/** Draws the top card (nothing happens when the library is empty). */
export function drawCard(state: HandState): HandState {
  const [top, ...rest] = state.library;
  if (top === undefined) return state;
  return { ...state, hand: [...state.hand, top], library: rest, turn: state.turn + 1 };
}

/** How many cards have been drawn by the end of `turn`: one per turn after the first, one more on the draw. */
export function drawsByTurn(turn: number, onTheDraw: boolean): number {
  return Math.max(0, turn - 1) + (onTheDraw ? 1 : 0);
}

/**
 * Deals hands, mulliganing and bottoming by the rule, until one is keepable. The cards drawn by
 * a turn are then `opening.library.slice(0, drawsByTurn(turn, onTheDraw))`.
 */
export function playOpening(cards: readonly LibraryCard[], rng: Rng, rule: MulliganRule): Opening {
  for (let mulligans = 0; ; mulligans++) {
    let state = dealHand(cards, rng, rule.freeMulligan, mulligans);
    while (state.toBottom > 0 && state.hand.length > 0) {
      state = bottomCard(state, chooseBottom(state.hand, rule.policy));
    }
    const keepable = isKeepable(state.hand, rule.policy);
    if (keepable || mulligans >= rule.maxMulligans) return { ...state, keptClean: keepable };
  }
}

export type TestHandEvent =
  | Readonly<{ kind: "newHand"; rng: Rng }>
  | Readonly<{ kind: "mulligan"; rng: Rng }>
  | Readonly<{ kind: "bottom"; key: string }>
  | Readonly<{ kind: "draw" }>;

/** The next state of a test game (section 7's table). Events that don't apply change nothing. */
export function nextHand(state: HandState, event: TestHandEvent): HandState {
  const everyCard = [...state.hand, ...state.library];
  switch (event.kind) {
    case "newHand":
      return dealHand(everyCard, event.rng, state.freeMulligan);
    case "mulligan":
      if (state.turn > 0 || state.toBottom > 0) return state;
      return dealHand(everyCard, event.rng, state.freeMulligan, state.mulligans + 1);
    case "bottom": {
      const card = state.hand.find((candidate) => candidate.key === event.key);
      return state.toBottom === 0 || card === undefined ? state : bottomCard(state, card);
    }
    case "draw":
      return state.toBottom > 0 ? state : drawCard(state);
  }
}
