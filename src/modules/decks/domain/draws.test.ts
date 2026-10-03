import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededRng, shuffled } from "@/shared/kernel";
import {
  deckOdds,
  hypergeometricAtLeast,
  library,
  nextHand,
  startHand,
  type DrawLine,
  type LibraryCard,
} from "./draws";

const line = (name: string, quantity: number, overrides: Partial<DrawLine> = {}): DrawLine => ({
  oracleId: name.toLowerCase(),
  name,
  printingId: `printing-${name}`,
  board: "main",
  quantity,
  typeLine: "Instant",
  ...overrides,
});

/** A 60-card deck: 24 lands, 36 spells. */
const SIXTY = library([
  line("Mountain", 24, { typeLine: "Basic Land — Mountain" }),
  line("Lightning Bolt", 36, { text: "Lightning Bolt deals 3 damage to any target." }),
]);

describe("library (invariant 5)", () => {
  it("has one entry per main-deck copy, no commanders and no sideboard", () => {
    const cards = library([
      line("Commander", 1, { board: "commander", typeLine: "Legendary Creature — Elf" }),
      line("Forest", 3, { typeLine: "Basic Land — Forest" }),
      line("Duress", 2, { board: "side" }),
      line("Sol Ring", 1, { typeLine: "Artifact", producedMana: ["C"] }),
    ]);
    expect(cards.map((card) => card.key)).toEqual([
      "forest#1",
      "forest#2",
      "forest#3",
      "sol ring#1",
    ]);
    expect(cards.filter((card) => card.isLand)).toHaveLength(3);
    expect(cards[3].tags).toEqual(["ramp"]);
  });
});

describe("test hands (section 7, invariant 6)", () => {
  const rng = seededRng("test-hand");

  it("deals 7 and keeps every card somewhere", () => {
    const hand = startHand(SIXTY, rng, false);
    expect(hand.hand).toHaveLength(7);
    expect(hand.hand.length + hand.library.length).toBe(60);
    expect(hand.toBottom).toBe(0);
  });

  it("London mulligan: draw 7, then bottom one per mulligan", () => {
    let hand = startHand(SIXTY, rng, false);
    hand = nextHand(hand, { kind: "mulligan", rng });
    expect(hand).toMatchObject({ mulligans: 1, toBottom: 1 });
    expect(hand.hand).toHaveLength(7);
    // Can't draw or mulligan again while a card is owed.
    expect(nextHand(hand, { kind: "draw" })).toBe(hand);
    expect(nextHand(hand, { kind: "mulligan", rng })).toBe(hand);
    const bottomed = hand.hand[2];
    hand = nextHand(hand, { kind: "bottom", key: bottomed.key });
    expect(hand.hand).toHaveLength(6);
    expect(hand.library.at(-1)).toBe(bottomed);
    expect(hand.toBottom).toBe(0);
    // A second mulligan owes two.
    hand = nextHand(hand, { kind: "mulligan", rng });
    expect(hand).toMatchObject({ mulligans: 2, toBottom: 2 });
  });

  it("Commander's first mulligan is free", () => {
    let hand = startHand(SIXTY, rng, true);
    hand = nextHand(hand, { kind: "mulligan", rng });
    expect(hand).toMatchObject({ mulligans: 1, toBottom: 0 });
    hand = nextHand(hand, { kind: "mulligan", rng });
    expect(hand).toMatchObject({ mulligans: 2, toBottom: 1 });
  });

  it("draws from the top, counts turns, and can't mulligan once the game starts", () => {
    let hand = startHand(SIXTY, rng, false);
    const top = hand.library[0];
    hand = nextHand(hand, { kind: "draw" });
    expect(hand.hand.at(-1)).toBe(top);
    expect(hand.turn).toBe(1);
    expect(nextHand(hand, { kind: "mulligan", rng })).toBe(hand);
    // A new hand starts over with every card.
    const fresh = nextHand(hand, { kind: "newHand", rng });
    expect(fresh).toMatchObject({ turn: 0, mulligans: 0 });
    expect(fresh.hand.length + fresh.library.length).toBe(60);
  });

  it("does nothing when the library is empty or the card isn't in hand", () => {
    const tiny = startHand(SIXTY.slice(0, 5), rng, false);
    expect(nextHand(tiny, { kind: "draw" })).toBe(tiny);
    expect(nextHand(tiny, { kind: "bottom", key: "nope" })).toBe(tiny);
  });
});

describe("hypergeometricAtLeast (invariant 7)", () => {
  it("knows the classic numbers", () => {
    // 24 lands in 60: at least one land in the opening 7 (1 − C(36,7)/C(60,7)).
    expect(hypergeometricAtLeast(60, 24, 7, 1)).toBeCloseTo(0.9784, 3);
    // A 4-of by the opening hand.
    expect(hypergeometricAtLeast(60, 4, 7, 1)).toBeCloseTo(0.3995, 3);
  });

  it("is 1 for nothing, 0 for the impossible", () => {
    expect(hypergeometricAtLeast(60, 4, 7, 0)).toBe(1);
    expect(hypergeometricAtLeast(60, 4, 7, 5)).toBe(0);
    expect(hypergeometricAtLeast(60, 0, 7, 1)).toBe(0);
    expect(hypergeometricAtLeast(5, 5, 10, 5)).toBeCloseTo(1);
  });

  const deck = fc.record({ population: fc.integer({ min: 1, max: 120 }) }).chain(({ population }) =>
    fc.record({
      population: fc.constant(population),
      successes: fc.integer({ min: 0, max: population }),
      draws: fc.integer({ min: 0, max: population }),
    }),
  );

  it("the exact counts sum to 1", () => {
    fc.assert(
      fc.property(deck, ({ population, successes, draws }) => {
        let total = 0;
        for (let k = 0; k <= draws; k++) {
          total +=
            hypergeometricAtLeast(population, successes, draws, k) -
            hypergeometricAtLeast(population, successes, draws, k + 1);
        }
        expect(total).toBeCloseTo(1, 9);
      }),
    );
  });

  it("stays in [0, 1] and grows with more draws", () => {
    fc.assert(
      fc.property(
        deck,
        fc.integer({ min: 1, max: 5 }),
        ({ population, successes, draws }, atLeast) => {
          const now = hypergeometricAtLeast(population, successes, draws, atLeast);
          const later = hypergeometricAtLeast(population, successes, draws + 1, atLeast);
          expect(now).toBeGreaterThanOrEqual(0);
          expect(now).toBeLessThanOrEqual(1);
          expect(later).toBeGreaterThanOrEqual(now - 1e-12);
        },
      ),
    );
  });

  it("matches a seeded simulation of 20 000 hands within 1.5 points", () => {
    const rng = seededRng("hypergeometric-check");
    const cards: boolean[] = [...Array(37).fill(true), ...Array(62).fill(false)]; // a 99-card library
    let hits = 0;
    const hands = 20_000;
    for (let i = 0; i < hands; i++) {
      const lands = shuffled(rng, cards).slice(0, 9).filter(Boolean).length;
      if (lands >= 3) hits++;
    }
    expect(Math.abs(hits / hands - hypergeometricAtLeast(99, 37, 9, 3))).toBeLessThan(0.015);
  });
});

describe("deckOdds", () => {
  it("shows land rows always, and role rows only for roles the deck has", () => {
    const rows = deckOdds(SIXTY, false);
    expect(rows.map((row) => row.label)).toEqual([
      "2–5 lands in the opening hand",
      "3 lands by turn 3",
      "4 lands by turn 4",
      "Removal by turn 4",
    ]);
    for (const row of rows) {
      expect(row.chance).toBeGreaterThan(0);
      expect(row.chance).toBeLessThanOrEqual(1);
    }
  });

  it("is better on the draw (one more card)", () => {
    const play = deckOdds(SIXTY, false);
    const draw = deckOdds(SIXTY, true);
    expect(draw[1].chance).toBeGreaterThan(play[1].chance);
  });

  it("is empty for an empty library", () => {
    expect(deckOdds([] as LibraryCard[], false)).toEqual([]);
  });
});
