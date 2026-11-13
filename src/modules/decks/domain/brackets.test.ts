import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BRACKET_FLAGS, type BracketFlag } from "@/shared/card-search";
import {
  BRACKETS,
  bracketWarning,
  estimateBracket,
  fitsTarget,
  flagsOverTarget,
  type Bracket,
  type BracketLine,
} from "./brackets";
import { BOARDS } from "./deck";

const line = (
  name: string,
  flags: readonly BracketFlag[] = [],
  overrides: Partial<BracketLine> = {},
): BracketLine => ({ name, quantity: 1, board: "main", flags, ...overrides });

const gameChangers = (count: number) =>
  Array.from({ length: count }, (_, index) => line(`Game Changer ${index + 1}`, ["gameChanger"]));

const floorOf = (lines: readonly BracketLine[]) => estimateBracket("commander", lines)?.floor;

const flags = fc.subarray([...BRACKET_FLAGS]);
const lineArbitrary = fc.record({
  name: fc.string({ maxLength: 8 }),
  quantity: fc.integer({ min: 1, max: 4 }),
  board: fc.constantFrom(...BOARDS),
  flags,
});

describe("estimateBracket", () => {
  it("leaves out the sideboard and the maybeboard (design doc 32)", () => {
    const parked = gameChangers(4).map((card, index) => ({
      ...card,
      board: index % 2 === 0 ? ("side" as const) : ("maybe" as const),
    }));
    expect(floorOf([line("Llanowar Elves"), ...parked])).toBe(1);
  });

  it("gives a deck with nothing flagged 1–2, with intent and combos unchecked", () => {
    expect(estimateBracket("commander", [line("Llanowar Elves")])).toEqual({
      floor: 1,
      range: { low: 1, high: 2 },
      findings: [],
      gameChangers: 0,
      unchecked: ["intent", "combos"],
    });
  });

  it("is null outside Commander (invariant 3)", () => {
    expect(estimateBracket("modern", gameChangers(5))).toBeNull();
  });

  it.each([
    [1, 3],
    [3, 3],
    [4, 4],
  ])("puts a deck with %i Game Changers at %i or above", (count, floor) => {
    expect(floorOf(gameChangers(count))).toBe(floor);
  });

  it("puts any land denial at 4, with the range 4–5", () => {
    const estimate = estimateBracket("commander", [line("Blood Moon", ["landDenial"])]);
    expect(estimate?.floor).toBe(4);
    expect(estimate?.range).toEqual({ low: 4, high: 5 });
  });

  it("allows a few extra turns in 2, and treats three or more as chaining (4)", () => {
    expect(floorOf([line("Time Warp", ["extraTurn"]), line("Nexus", ["extraTurn"])])).toBe(2);
    expect(floorOf([line("Time Warp", ["extraTurn"], { quantity: 3 })])).toBe(4);
  });

  it("ignores the sideboard and counts the commander (invariant 4)", () => {
    const lines = [
      line("Tergrid, God of Fright", ["gameChanger"], { board: "commander" }),
      line("Armageddon", ["landDenial"], { board: "side" }),
    ];
    const estimate = estimateBracket("commander", lines);
    expect(estimate?.floor).toBe(3);
    expect(estimate?.findings).toEqual([
      { rule: "gameChangers", cards: ["Tergrid, God of Fright"], count: 1, forces: 3 },
    ]);
  });

  it("counts copies, and lists every card that trips a rule (invariant 6)", () => {
    const estimate = estimateBracket("commander", [
      line("Rhystic Study", ["gameChanger"]),
      line("Smothering Tithe", ["gameChanger"], { quantity: 2 }),
    ]);
    expect(estimate?.gameChangers).toBe(3);
    expect(estimate?.findings[0]?.cards).toEqual(["Rhystic Study", "Smothering Tithe"]);
  });

  it("checks two-card combos when provided and removes combos from unchecked", () => {
    const clean = estimateBracket("commander", [line("Llanowar Elves")], { combos: [] });
    expect(clean?.floor).toBe(1);
    expect(clean?.unchecked).toEqual(["intent"]);

    const late = estimateBracket("commander", [line("Kiki-Jiki"), line("Zealous Conscripts")], {
      combos: [
        {
          id: "c-late",
          cards: ["Kiki-Jiki", "Zealous Conscripts"],
          produces: ["Infinite creature tokens"],
          forces: 3,
        },
      ],
    });
    expect(late?.floor).toBe(3);
    expect(late?.unchecked).toEqual(["intent"]);
    expect(late?.findings).toContainEqual({
      rule: "twoCardCombos",
      cards: ["Kiki-Jiki", "Zealous Conscripts"],
      count: 1,
      forces: 3,
    });

    const early = estimateBracket(
      "commander",
      [line("Thassa's Oracle"), line("Demonic Consultation")],
      {
        combos: [
          {
            id: "c-early",
            cards: ["Thassa's Oracle", "Demonic Consultation"],
            produces: ["Win the game"],
            forces: 4,
          },
        ],
      },
    );
    expect(early?.floor).toBe(4);
  });

  it("never lowers the floor when a card is added, and never reaches 5 (invariants 2, 3)", () => {
    fc.assert(
      fc.property(fc.array(lineArbitrary, { maxLength: 12 }), lineArbitrary, (lines, added) => {
        const before = floorOf(lines) ?? 1;
        const after = floorOf([...lines, added]) ?? 1;
        expect(after).toBeGreaterThanOrEqual(before);
        expect(after).toBeLessThan(5);
      }),
    );
  });
});

describe("bracketWarning", () => {
  it("is null with no target, no estimate, or within the target", () => {
    const estimate = estimateBracket("commander", gameChangers(2));
    expect(bracketWarning(estimate, null)).toBeNull();
    expect(bracketWarning(null, 2)).toBeNull();
    expect(bracketWarning(estimate, 3)).toBeNull();
  });

  it("names only the findings above the target", () => {
    const estimate = estimateBracket("commander", [
      ...gameChangers(1),
      line("Time Warp", ["extraTurn"]),
    ]);
    expect(bracketWarning(estimate, 2)).toEqual({
      kind: "OverTargetBracket",
      target: 2,
      floor: 3,
      findings: [{ rule: "gameChangers", cards: ["Game Changer 1"], count: 1, forces: 3 }],
    });
  });

  it("is null exactly when the floor is within the target (invariant 11)", () => {
    fc.assert(
      fc.property(
        fc.array(lineArbitrary, { maxLength: 12 }),
        fc.constantFrom(...BRACKETS),
        (lines, target) => {
          const estimate = estimateBracket("commander", lines);
          expect(bracketWarning(estimate, target) === null).toBe((estimate?.floor ?? 1) <= target);
        },
      ),
    );
  });
});

describe("fitsTarget", () => {
  const card = (flags: readonly BracketFlag[]) => ({ name: "Candidate", flags });

  it("allows a third Game Changer in bracket 3 but not a fourth", () => {
    expect(fitsTarget(gameChangers(2), card(["gameChanger"]), 3)).toBe(true);
    expect(fitsTarget(gameChangers(3), card(["gameChanger"]), 3)).toBe(false);
  });

  it("allows no Game Changers or land denial in bracket 2, and extra turns up to two", () => {
    expect(fitsTarget([], card(["gameChanger"]), 2)).toBe(false);
    expect(fitsTarget([], card(["landDenial"]), 3)).toBe(false);
    expect(fitsTarget([line("Time Warp", ["extraTurn"])], card(["extraTurn"]), 2)).toBe(true);
    expect(
      fitsTarget([line("Time Warp", ["extraTurn"], { quantity: 2 })], card(["extraTurn"]), 3),
    ).toBe(false);
  });

  it("leaves nothing out in bracket 4 or 5", () => {
    expect(fitsTarget(gameChangers(9), card(["gameChanger", "landDenial"]), 4)).toBe(true);
  });

  it("doesn't blame a card for what's already over the target", () => {
    // Bracket 2 with a Game Changer already in: an extra-turn card is still fine, another
    // Game Changer isn't.
    expect(fitsTarget(gameChangers(1), card(["extraTurn"]), 2)).toBe(true);
    expect(fitsTarget(gameChangers(1), card(["gameChanger"]), 2)).toBe(false);
  });

  it("agrees with estimating the deck with the card added, while the deck is within target", () => {
    fc.assert(
      fc.property(
        fc.array(lineArbitrary, { maxLength: 12 }),
        flags,
        fc.constantFrom<Bracket>(...BRACKETS),
        (lines, candidateFlags, target) => {
          fc.pre((floorOf(lines) ?? 1) <= target);
          const withCard = [...lines, line("Candidate", candidateFlags)];
          expect(fitsTarget(lines, card(candidateFlags), target)).toBe(
            (floorOf(withCard) ?? 1) <= target,
          );
        },
      ),
    );
  });

  it("never lets a card it accepts raise the floor above the target, or above what it was", () => {
    fc.assert(
      fc.property(
        fc.array(lineArbitrary, { maxLength: 12 }),
        flags,
        fc.constantFrom<Bracket>(...BRACKETS),
        (lines, candidateFlags, target) => {
          if (!fitsTarget(lines, card(candidateFlags), target)) return;
          const before = floorOf(lines) ?? 1;
          const after = floorOf([...lines, line("Candidate", candidateFlags)]) ?? 1;
          expect(after).toBeLessThanOrEqual(Math.max(before, target));
        },
      ),
    );
  });
});

describe("flagsOverTarget", () => {
  it("names the flags a card can't have in a deck with this target", () => {
    expect(flagsOverTarget([], 1)).toEqual(["gameChanger", "landDenial", "extraTurn"]);
    expect(flagsOverTarget([], 2)).toEqual(["gameChanger", "landDenial"]);
    expect(flagsOverTarget(gameChangers(3), 3)).toEqual(["gameChanger", "landDenial"]);
    expect(flagsOverTarget([], 4)).toEqual([]);
  });

  it("agrees with fitsTarget for cards with several flags", () => {
    fc.assert(
      fc.property(
        fc.array(lineArbitrary, { maxLength: 12 }),
        flags,
        fc.constantFrom<Bracket>(...BRACKETS),
        (lines, candidateFlags, target) => {
          const over = flagsOverTarget(lines, target);
          expect(fitsTarget(lines, { name: "Candidate", flags: candidateFlags }, target)).toBe(
            !candidateFlags.some((flag) => over.includes(flag)),
          );
        },
      ),
    );
  });
});
