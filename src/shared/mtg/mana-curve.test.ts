import { describe, expect, it } from "vitest";
import { CURVE_SLOTS, curveSlot, curveSlotLabel, manaCurve } from "./mana-curve";

describe("curveSlot", () => {
  it("rounds fractions down", () => {
    expect(curveSlot(0.5)).toBe(0);
    expect(curveSlot(2.5)).toBe(2);
    expect(curveSlot(3)).toBe(3);
  });

  it("runs from 0 to 7+: seven and everything above share the last slot", () => {
    expect([0, 1, 6, 7, 8, 16].map(curveSlot)).toEqual([0, 1, 6, 7, 7, 7]);
    expect(CURVE_SLOTS).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(curveSlotLabel(6)).toBe("6");
    expect(curveSlotLabel(7)).toBe("7+");
  });

  it("puts a negative mana value in slot 0", () => {
    expect(curveSlot(-1)).toBe(0);
  });
});

describe("manaCurve", () => {
  const spell = (manaValue: number, quantity = 1, typeLine = "Creature — Elf") => ({
    typeLine,
    manaValue,
    quantity,
  });

  it("counts copies by slot and leaves lands out", () => {
    expect(
      manaCurve([spell(2, 3), spell(2), spell(9, 2), spell(0, 1, "Land"), spell(4, 1, "Instant")]),
    ).toEqual([0, 0, 4, 0, 1, 0, 0, 2]);
  });

  it("puts a split card in the slot of its total mana value (Fire // Ice is 4)", () => {
    expect(manaCurve([spell(4, 1, "Instant // Instant")])[4]).toBe(1);
  });

  it("counts an X in a cost as 0 (Fireball, {X}{R}, has mana value 1)", () => {
    expect(manaCurve([spell(1, 1, "Sorcery")])[1]).toBe(1);
    expect(manaCurve([spell(0, 1, "Sorcery")])[0]).toBe(1);
  });

  it("counts a double-faced card with a land face as a land (decision 1)", () => {
    expect(manaCurve([spell(3, 1, "Sorcery // Land")])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(manaCurve([spell(2, 1, "Creature — Human // Creature — Werewolf")])[2]).toBe(1);
  });

  it("is all zeros for no lines", () => {
    expect(manaCurve([])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
