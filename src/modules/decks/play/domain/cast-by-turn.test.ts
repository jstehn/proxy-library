import { describe, expect, it } from "vitest";
import { seededRng, type ManaSymbol } from "@/shared/kernel";
import { simulateCasting, type CastOptions, type CastTarget } from "./cast-by-turn";
import { effectOf, totalDiscount, type CardEffect } from "./cast-effects";
import { hypergeometricAtLeast } from "./draws";
import { COMMANDER_KEEP } from "./opening-hand/hand";
import { library, type DrawLine } from "./opening-hand/library";

const NO_MULLIGAN = { policy: COMMANDER_KEEP, freeMulligan: false, maxMulligans: 0 };

function options(overrides: Partial<CastOptions> = {}): CastOptions {
  return {
    rng: seededRng("cast-by-turn"),
    runs: 200,
    onTheDraw: false,
    lastTurn: 5,
    rule: NO_MULLIGAN,
    ...overrides,
  };
}

function card(name: string, quantity: number, overrides: Partial<DrawLine> = {}): DrawLine {
  return {
    oracleId: name.toLowerCase(),
    name,
    printingId: `printing-${name}`,
    board: "main",
    quantity,
    typeLine: "Sorcery",
    manaValue: 9,
    ...overrides,
  };
}

const TAPS = { isSource: true, amount: 1, requiresFiveLands: false } as const;

function land(name: string, quantity: number, color: string): DrawLine {
  return card(name, quantity, {
    typeLine: "Basic Land",
    manaValue: 0,
    producedMana: [color],
    tapMana: TAPS,
  });
}

function target(overrides: Partial<CastTarget>): CastTarget {
  return {
    name: "Target",
    typeLine: "Creature",
    manaValue: 3,
    pips: [["B"], ["B"]],
    mustDraw: false,
    ...overrides,
  };
}

/** The first turn the target was castable in every run; the deck is seven cards, all in the hand. */
function firstTurn(lines: DrawLine[], cast: CastTarget): number | null {
  const [curve] = simulateCasting(library(lines), [cast], options({ runs: 20 })).curves;
  return curve.byTurn.findIndex((chance) => chance === 1) + 1 || null;
}

describe("the cast simulator", () => {
  // Seven cards, so the whole deck is the opening hand.
  const sevenCards = (...extra: DrawLine[]) => [
    land("Swamp", 1, "B"),
    land("Swamp 2", 1, "B"),
    ...extra,
  ];

  it("Dark Ritual makes a 3-mana spell castable on turn 1", () => {
    const withRitual = sevenCards(
      card("Dark Ritual", 1, { typeLine: "Instant", manaValue: 1 }),
      card("Filler", 4),
    );
    const without = sevenCards(card("Filler", 5));
    // {1}{B}{B}: one Swamp on turn 1 is a single B; the ritual turns it into BBB.
    expect(firstTurn(withRitual, target({ pips: [["B"], ["B"]] }))).toBe(1);
    expect(firstTurn(without, target({ pips: [["B"], ["B"]] }))).toBeNull();
  });

  it("a card with no listed effect changes nothing", () => {
    const unlisted = sevenCards(
      card("Mystery Instant", 1, { typeLine: "Instant", manaValue: 1 }),
      card("Filler", 4),
    );
    expect(firstTurn(unlisted, target({}))).toBeNull();
  });

  it("a ritual cannot be paid without its colour", () => {
    const plains = [
      land("Plains", 2, "W"),
      card("Dark Ritual", 1, { typeLine: "Instant", manaValue: 1 }),
      card("Filler", 4),
    ];
    expect(firstTurn(plains, target({ pips: [["B"]], manaValue: 1 }))).toBeNull();
  });

  it("a cost reducer in play takes generic mana off a matching spell", () => {
    const reducer: CardEffect = { kind: "reducer", generic: 1, spellTypes: ["Artifact"] };
    expect(totalDiscount([reducer], { typeLine: "Artifact Creature — Golem" })).toBe(1);
    expect(totalDiscount([reducer], { typeLine: "Creature — Elf" })).toBe(0);

    const artifact = target({ typeLine: "Artifact", manaValue: 5, pips: [] });
    const fiveLands = (...extra: DrawLine[]) => [land("Island", 5, "U"), ...extra];
    const withInspector = fiveLands(
      card("Foundry Inspector", 1, { typeLine: "Artifact Creature", manaValue: 3 }),
      card("Filler", 1),
    );
    expect(firstTurn(withInspector, artifact)).toBe(4);
    expect(firstTurn(fiveLands(card("Filler", 2)), artifact)).toBe(5);
  });

  it("gives the same curve for the same seed, and a curve that never falls", () => {
    const lines = [land("Swamp", 17, "B"), card("Filler", 43)];
    const first = simulateCasting(library(lines), [target({})], options());
    const second = simulateCasting(library(lines), [target({})], options());
    expect(first).toEqual(second);
    const { byTurn } = first.curves[0];
    expect(byTurn).toEqual([...byTurn].sort((a, b) => a - b));
    expect(first.marginOfError).toBeCloseTo(0.0693, 3);
  });

  it("names the commonest reason a run missed", () => {
    const forests = [land("Forest", 30, "G"), card("Filler", 30)];
    const [curve] = simulateCasting(library(forests), [target({})], options()).curves;
    expect(curve.byTurn.at(-1)).toBe(0);
    expect(curve.misses[0].reason).toBe("noSource:B");
  });

  it("matches the exact hypergeometric chance of having drawn a card by each turn", () => {
    const lines = [card("Wanted", 4, { manaValue: 0 }), card("Filler", 56)];
    const wanted = target({ name: "Wanted", manaValue: 0, pips: [], mustDraw: true });
    const [curve] = simulateCasting(
      library(lines),
      [wanted],
      options({ runs: 4000, lastTurn: 6 }),
    ).curves;
    curve.byTurn.forEach((chance, index) => {
      const cardsSeen = 7 + index; // seven in hand, one more each turn after the first
      expect(Math.abs(chance - hypergeometricAtLeast(60, 4, cardsSeen, 1))).toBeLessThan(0.03);
    });
  });

  const withoutFetch = (line: DrawLine): DrawLine => ({ ...line, landFetch: null });

  describe("a spell that puts a land onto the battlefield", () => {
    const ANY_BASIC = ["W", "U", "B", "R", "G"] as const;
    const fetcher = (
      name: string,
      manaValue: number,
      entersTapped: boolean,
      colors: readonly ManaSymbol[] = ANY_BASIC,
    ) => card(name, 1, { manaValue, roles: ["ramp"], landFetch: { entersTapped, colors } });
    const fourDrop = target({ manaValue: 4, pips: [["G"]] });

    it("Rampant Growth on turn 2 makes a four-drop castable on turn 3", () => {
      const forests = (count: number) => land("Forest", count, "G");
      const withGrowth = [forests(3), fetcher("Rampant Growth", 2, true), card("Filler", 3)];
      const without = [forests(3), card("Filler", 4)];
      expect(firstTurn(withGrowth, fourDrop)).toBe(3);
      expect(firstTurn(without, fourDrop)).toBeNull();
    });

    it("fetches the colour the target is missing", () => {
      const needsBlack = target({ manaValue: 4, pips: [["G"], ["B"]] });
      const lines = [land("Forest", 4, "G"), fetcher("Cultivate", 3, true), card("Filler", 2)];
      expect(firstTurn(lines, needsBlack)).toBe(4);
      expect(firstTurn(lines.map(withoutFetch), needsBlack)).toBeNull();
    });

    it("is read from the card's features: Cultivate enters tapped, Three Visits does not", () => {
      const effect = (line: DrawLine) => effectOf(library([line])[0]);
      expect(effect(fetcher("Cultivate", 3, true))).toMatchObject({ entersTapped: true });
      expect(effect(fetcher("Three Visits", 2, false, ["G"]))).toEqual({
        kind: "landFetch",
        entersTapped: false,
        colors: ["G"],
      });
      // Without the ramp tag, or on a land, the fetch is ignored.
      expect(effect({ ...fetcher("Tutor", 2, false), roles: [] })).toBeUndefined();
      expect(effect({ ...fetcher("Evolving Wilds", 0, true), typeLine: "Land" })).toBeUndefined();
    });
  });
});
