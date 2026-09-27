import { describe, expect, it } from "vitest";
import { manaClass, manaTokens } from "./mana";

describe("manaTokens", () => {
  it("splits text and symbols", () => {
    expect(manaTokens("{2}{W}, {T}: Draw a card.")).toEqual([
      { kind: "symbol", symbol: "2" },
      { kind: "symbol", symbol: "W" },
      { kind: "text", text: ", " },
      { kind: "symbol", symbol: "T" },
      { kind: "text", text: ": Draw a card." },
    ]);
  });

  it("returns plain text unchanged, and nothing for empty text", () => {
    expect(manaTokens("Flying")).toEqual([{ kind: "text", text: "Flying" }]);
    expect(manaTokens("")).toEqual([]);
  });
});

describe("manaClass", () => {
  it.each([
    ["W", "w"],
    ["12", "12"],
    ["T", "tap"],
    ["Q", "untap"],
    ["W/U", "wu"],
    ["2/W", "2w"],
    ["G/P", "gp"],
  ])("%s → ms-%s", (symbol, expected) => {
    expect(manaClass(symbol)).toBe(expected);
  });
});
