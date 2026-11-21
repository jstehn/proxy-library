import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import {
  chooseBottom,
  COMMANDER_KEEP,
  drawsByTurn,
  isEarlyRamp,
  isKeepable,
  playOpening,
} from "./hand";
import { library, type DrawLine } from "./library";

function line(name: string, quantity: number, overrides: Partial<DrawLine> = {}): DrawLine {
  return {
    oracleId: name.toLowerCase(),
    name,
    printingId: `printing-${name}`,
    board: "main",
    quantity,
    typeLine: "Creature — Elf",
    manaValue: 2,
    ...overrides,
  };
}

const LAND = { typeLine: "Basic Land — Forest", manaValue: 0 };
const cards = library([
  line("Forest", 38, LAND),
  line("Elves", 8, { manaValue: 1, roles: ["ramp"] }),
  line("Giant", 53, { manaValue: 6 }),
]);
const RULE = { policy: COMMANDER_KEEP, freeMulligan: true, maxMulligans: 2 };

describe("keep rule and bottoming", () => {
  const forest = cards[0];
  const elves = cards.filter((card) => card.name === "Elves")[0];
  const giants = cards.filter((card) => card.name === "Giant");

  it("keeps 2 to 4 lands with a spell castable by turn 3", () => {
    expect(isKeepable([forest, forest, elves, giants[0]], COMMANDER_KEEP)).toBe(true);
    expect(isKeepable([forest, elves, giants[0]], COMMANDER_KEEP)).toBe(false);
    expect(isKeepable([forest, forest, giants[0], giants[1]], COMMANDER_KEEP)).toBe(false);
    expect(
      isKeepable([forest, forest, giants[0]], { ...COMMANDER_KEEP, requireEarlyPlay: false }),
    ).toBe(true);
    expect(isEarlyRamp(elves)).toBe(true);
  });

  it("bottoms a land when there are too many, otherwise the dearest spell", () => {
    expect(chooseBottom([giants[0], forest, forest, forest, forest, forest], COMMANDER_KEEP)).toBe(
      forest,
    );
    expect(chooseBottom([forest, forest, elves, giants[0]], COMMANDER_KEEP)).toBe(giants[0]);
    expect(chooseBottom([forest, forest], COMMANDER_KEEP)).toBe(forest);
  });
});

describe("playOpening", () => {
  it("is repeatable for a seed and keeps every card", () => {
    const first = playOpening(cards, seededRng("open"), RULE);
    const second = playOpening(cards, seededRng("open"), RULE);
    expect(second).toEqual(first);
    expect(first.hand.length + first.library.length).toBe(cards.length);
    expect(first.hand).toHaveLength(7 - Math.max(0, first.mulligans - 1));
  });

  it("keeps the last hand when the mulligans run out", () => {
    const lands = library([line("Forest", 40, LAND)]);
    const opening = playOpening(lands, seededRng("flood"), RULE);
    expect(opening).toMatchObject({ keptClean: false, mulligans: 2, toBottom: 0 });
    expect(opening.hand).toHaveLength(6);
  });

  it("counts the cards drawn by a turn", () => {
    expect(drawsByTurn(1, false)).toBe(0);
    expect(drawsByTurn(3, false)).toBe(2);
    expect(drawsByTurn(3, true)).toBe(3);
  });
});
