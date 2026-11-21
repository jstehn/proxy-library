import { type Rng } from "@/shared/kernel";
import { type ManaSymbol } from "@/shared/mtg";
import {
  castRitual,
  colorsOf,
  effectOf,
  CAST_EFFECTS,
  type LandInPlay,
  producedBy,
  totalDiscount,
  type CardEffect,
} from "./cast-effects";
import { canPay, firstUnpaidPip, type PaymentSource, type Pip } from "@/modules/decks/core/client";
import { drawsByTurn, playOpening, type MulliganRule, type Opening } from "./opening-hand/hand";
import type { LibraryCard } from "./opening-hand/library";

// The one cast simulator (P28): "what is the chance I can cast X by turn Y?", estimated by
// bootstrapping. Each run shuffles the deck, deals the opening hand by the mulligan rule, then
// plays turn by turn (draw, one land, ramp and cost reducers cast ahead) and records the first
// turn X could be cast. All runs together give the whole curve. Pure and seeded (ADR 0008): a
// run count is the time budget, so a seed always gives the same answer.

export type CastTarget = Readonly<{
  name: string;
  typeLine: string;
  /** The mana value to pay, with declared cost reducers already counted. */
  manaValue: number;
  pips: readonly Pip[];
  /** True when the card has to be in hand; false for the command zone, where only mana matters. */
  mustDraw: boolean;
  /** Where this card's curve ends; the run's `lastTurn` when left out. */
  lastTurn?: number;
}>;

export type CastOptions = Readonly<{
  rng: Rng;
  runs: number;
  onTheDraw: boolean;
  lastTurn: number;
  rule: MulliganRule;
}>;

/** Why runs failed by the last turn, as a share of all runs. */
export type CastMiss = Readonly<{
  reason: "notDrawn" | "tooLittleMana" | `noSource:${ManaSymbol}`;
  share: number;
}>;

export type CastCurve = Readonly<{
  name: string;
  /** The chance the card was castable by turn 1, 2, … (cumulative). */
  byTurn: readonly number[];
  /** The first turn the chance reaches one half; null if it never does. */
  medianTurn: number | null;
  /** Biggest first. */
  misses: readonly CastMiss[];
}>;

export type CastSimulation = Readonly<{
  runs: number;
  /** Half the width of the 95% interval, worst case (a chance of one half). */
  marginOfError: number;
  curves: readonly CastCurve[];
}>;

type Outcome = Readonly<{ turn: number } | { reason: CastMiss["reason"] }>;

type Tally = { castOn: number[]; misses: Map<CastMiss["reason"], number> };

export function simulateCasting(
  cards: readonly LibraryCard[],
  targets: readonly CastTarget[],
  options: CastOptions,
): CastSimulation {
  const { runs } = options;
  const lastTurnOf = (target: CastTarget) => target.lastTurn ?? options.lastTurn;
  const tallies: Tally[] = targets.map((target) => ({
    castOn: Array.from({ length: lastTurnOf(target) + 1 }, () => 0),
    misses: new Map(),
  }));

  for (let run = 0; run < runs; run++) {
    const opening = playOpening(cards, options.rng, options.rule);
    targets.forEach((target, index) => {
      const outcome = playTarget(opening, target, lastTurnOf(target), options);
      if ("turn" in outcome) tallies[index].castOn[outcome.turn] += 1;
      else
        tallies[index].misses.set(
          outcome.reason,
          (tallies[index].misses.get(outcome.reason) ?? 0) + 1,
        );
    });
  }

  const curves = targets.map((target, index) => curveOf(target.name, tallies[index], runs));
  return { runs, marginOfError: 1.96 * Math.sqrt(0.25 / runs), curves };
}

function curveOf(name: string, tally: Tally, runs: number): CastCurve {
  let castSoFar = 0;
  const byTurn = tally.castOn.slice(1).map((count) => {
    castSoFar += count;
    return Math.round((castSoFar / runs) * 1000) / 1000;
  });
  const median = byTurn.findIndex((chance) => chance >= 0.5);
  const misses = [...tally.misses]
    .map(([reason, count]) => ({ reason, share: Math.round((count / runs) * 1000) / 1000 }))
    .sort((a, b) => b.share - a.share);
  return { name, byTurn, medianTurn: median === -1 ? null : median + 1, misses };
}

type PlayedLand = Readonly<{ card: LandInPlay; tappedNow: boolean }>;

/** Plays one game for one target; the first turn it is castable, or why it was not. */
function playTarget(
  opening: Opening,
  target: CastTarget,
  lastTurn: number,
  options: CastOptions,
): Outcome {
  const hand = [...opening.hand];
  const lands: PlayedLand[] = [];
  const permanents: PaymentSource[] = [];
  const reducers: CardEffect[] = [];
  const holdsTarget = () => hand.some((card) => sameName(card.name, target.name));
  let mana: PaymentSource[] = [];

  for (let turn = 1; turn <= lastTurn; turn++) {
    const drawnBefore = turn === 1 ? 0 : drawsByTurn(turn - 1, options.onTheDraw);
    hand.push(...opening.library.slice(drawnBefore, drawsByTurn(turn, options.onTheDraw)));

    // Lands untap, the fetched tapped ones included, before the turn's land drop.
    lands.forEach((played, index) => (lands[index] = { ...played, tappedNow: false }));
    const land = takeLand(hand, lands, target.pips);
    if (land !== undefined) lands.push({ card: land, tappedNow: entersTapped(land, lands.length) });
    const landCount = lands.length;
    mana = [
      ...lands
        .filter((played) => !played.tappedNow)
        .flatMap((played) => landMana(played.card, landCount)),
      ...permanents,
    ];

    const discount = totalDiscount(reducers, target);
    if ((!target.mustDraw || holdsTarget()) && canCast(target, mana, discount, hand)) {
      return { turn };
    }
    if (turn < lastTurn)
      castAhead(hand, mana.length, { permanents, reducers, lands, pips: target.pips });
  }

  return {
    reason: whyNot(
      target,
      mana,
      totalDiscount(reducers, target),
      !target.mustDraw || holdsTarget(),
    ),
  };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function manaNeeded(target: CastTarget, discount: number): number {
  return Math.max(target.pips.length, target.manaValue - discount);
}

/** Whether the mana pays for the target, using rituals in hand if that is what it takes. */
function canCast(
  target: CastTarget,
  mana: readonly PaymentSource[],
  discount: number,
  hand: readonly LibraryCard[],
): boolean {
  const needed = manaNeeded(target, discount);
  if (canPay(target.pips, mana, needed)) return true;
  let pool = mana;
  for (const card of hand) {
    const effect = effectOf(card);
    const afterRitual = effect === undefined ? null : castRitual(effect, pool);
    if (afterRitual === null) continue;
    pool = afterRitual;
    if (canPay(target.pips, pool, needed)) return true;
  }
  return false;
}

/** What cast-ahead cards add to: mana from permanents, cost reducers, and lands in play. */
type InPlay = Readonly<{
  permanents: PaymentSource[];
  reducers: CardEffect[];
  lands: PlayedLand[];
  pips: readonly Pip[];
}>;

/** Casts ramp and cost reducers from hand with the mana to spare; they work from next turn. */
function castAhead(hand: LibraryCard[], manaToSpare: number, inPlay: InPlay): void {
  const candidates = hand
    .filter(
      (card) =>
        !card.isLand && ["tapMana", "reducer", "landFetch"].includes(effectOf(card)?.kind ?? ""),
    )
    .sort((a, b) => (a.manaValue ?? 99) - (b.manaValue ?? 99));
  let budget = manaToSpare;
  for (const card of candidates) {
    const cost = card.manaValue ?? 99;
    if (cost > budget) break;
    budget -= cost;
    hand.splice(hand.indexOf(card), 1);
    const effect = effectOf(card);
    if (effect === undefined) continue;
    if (effect.kind === "landFetch") {
      const card = CAST_EFFECTS.landFetch.fetches?.(effect, missingPips(inPlay.lands, inPlay.pips));
      if (card !== undefined) inPlay.lands.push({ card, tappedNow: effect.entersTapped });
    } else if (effect.kind === "reducer") inPlay.reducers.push(effect);
    else inPlay.permanents.push(...producedBy(effect));
  }
}

/** The pips of the target no land in play makes a colour for yet. */
function missingPips(inPlay: readonly PlayedLand[], pips: readonly Pip[]): Pip[] {
  return pips.filter(
    (pip) => !inPlay.some((played) => pip.some((color) => colorsOf(played.card).includes(color))),
  );
}

/**
 * Takes the land to play from the hand: the one that adds a colour the target still needs and has
 * no source of yet, then one that enters untapped.
 */
function takeLand(
  hand: LibraryCard[],
  inPlay: readonly PlayedLand[],
  pips: readonly Pip[],
): LibraryCard | undefined {
  const missing = missingPips(inPlay, pips);
  const makes = (card: LibraryCard, pip: Pip) =>
    pip.some((color) => colorsOf(card).includes(color));
  const untappedRank = { never: 2, sometimes: 1, always: 0 } as const;
  const score = (card: LibraryCard) =>
    missing.filter((pip) => makes(card, pip)).length * 4 +
    untappedRank[card.entersTapped ?? "never"];
  let best: LibraryCard | undefined;
  for (const card of hand) {
    if (card.isLand && (best === undefined || score(card) > score(best))) best = card;
  }
  if (best !== undefined) hand.splice(hand.indexOf(best), 1);
  return best;
}

/** A land with a condition ("unless you control a land") enters tapped only as your first land. */
function entersTapped(card: LibraryCard, landsInPlay: number): boolean {
  if (card.entersTapped === "sometimes") return landsInPlay === 0;
  return card.entersTapped === "always";
}

/** What a land in play taps for; a land that needs five lands makes nothing before the fifth. */
function landMana(card: LandInPlay, landCount: number): PaymentSource[] {
  const needsFive = card.tapMana?.requiresFiveLands === true;
  if (needsFive && landCount < 5) return [];
  const amount = needsFive ? 2 : Math.max(1, card.tapMana?.amount ?? 1);
  return Array.from({ length: amount }, () => colorsOf(card));
}

function whyNot(
  target: CastTarget,
  mana: readonly PaymentSource[],
  discount: number,
  holdsTarget: boolean,
): CastMiss["reason"] {
  if (!holdsTarget) return "notDrawn";
  if (mana.length < manaNeeded(target, discount)) return "tooLittleMana";
  const unpaid = firstUnpaidPip(target.pips, mana);
  return `noSource:${unpaid?.find((color) => color !== "C") ?? "C"}`;
}
