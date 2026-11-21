import { describe, expect, it } from "vitest";
import { canPay, firstUnpaidPip, parseCost } from "./mana";

describe("parseCost", () => {
  it("reads generic mana, single colours, hybrid, two-brid and Phyrexian symbols", () => {
    expect(parseCost("{2}{U/B}{G}{G/P}{2/R}{C}{X}")).toEqual({
      pips: [["U", "B"], ["G"], ["R"], ["C"]],
      phyrexian: ["G"],
      generic: 2,
    });
    expect(parseCost(null)).toEqual({ pips: [], phyrexian: [], generic: 0 });
  });
});

describe("firstUnpaidPip", () => {
  it("gives each pip its own source, moving a flexible source where it is needed", () => {
    expect(firstUnpaidPip([["B"], ["G"]], [["B", "G"], ["G"]])).toBeNull();
    expect(firstUnpaidPip([["G"], ["B"]], [["B", "G"], ["G"]])).toBeNull();
    expect(firstUnpaidPip([["B"], ["R"]], [["B"], ["B"]])).toEqual(["R"]);
    expect(firstUnpaidPip([["B"], ["R"], ["G"]], [["B", "R", "G"], ["B"]])).not.toBeNull();
    expect(firstUnpaidPip([], [])).toBeNull();
  });

  it("pays a hybrid pip with either colour, and a colourless pip only with colourless mana", () => {
    expect(firstUnpaidPip([["U", "B"], ["U"]], [["U"], ["B"]])).toBeNull();
    expect(firstUnpaidPip([["C"]], [["G"]])).toEqual(["C"]);
  });
});

describe("canPay", () => {
  it("also needs enough sources for the whole cost", () => {
    expect(canPay([["G"]], [["G"], ["C"]], 3)).toBe(false);
    expect(canPay([["G"]], [["G"], ["C"], ["C"]], 3)).toBe(true);
  });
});
