import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colorsOfCost, costSymbols, splitSymbols, symbolArt } from "./mana-symbols";

// Every symbol Scryfall knows, recorded from GET /symbology.
const symbology = JSON.parse(readFileSync("tests/fixtures/scryfall/symbology.json", "utf8")) as {
  data: { symbol: string }[];
};

describe("splitSymbols", () => {
  it("separates symbols from the words around them", () => {
    expect(splitSymbols("{T}: Add {G}.")).toEqual([
      { kind: "symbol", symbol: "T" },
      { kind: "text", text: ": Add " },
      { kind: "symbol", symbol: "G" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves text without symbols alone", () => {
    expect(splitSymbols("Flying")).toEqual([{ kind: "text", text: "Flying" }]);
    expect(splitSymbols("")).toEqual([]);
  });
});

describe("costSymbols and colorsOfCost", () => {
  it("reads each symbol of a cost", () => {
    expect(costSymbols("{1}{G/W}{G/W}")).toEqual(["1", "G/W", "G/W"]);
    expect(costSymbols(null)).toEqual([]);
  });

  it("finds the colours a cost asks for, in WUBRG order", () => {
    expect(colorsOfCost("{1}{G/W}{G/W}")).toEqual(["W", "G"]);
    expect(colorsOfCost("{2/U}{R/P}")).toEqual(["U", "R"]);
    expect(colorsOfCost("{C}{4}")).toEqual([]);
    expect(colorsOfCost(null)).toEqual([]);
  });
});

describe("symbolArt", () => {
  it("has the Mana font's glyph for every symbol Scryfall knows", () => {
    const missing = symbology.data
      .map((entry) => entry.symbol.slice(1, -1))
      .filter((symbol) => symbolArt(symbol) === null);
    expect(missing).toEqual([]);
  });

  it("draws a coloured symbol on its colour, and generic mana on grey", () => {
    expect(symbolArt("W")).toEqual({
      kind: "single",
      glyph: "",
      background: "#f0f2c0",
      foreground: "#111111",
      scale: 1,
    });
    expect(symbolArt("2")).toMatchObject({ glyph: "", background: "#beb9b2" });
    expect(symbolArt("16")).toMatchObject({ glyph: "" });
  });

  it("splits hybrid symbols between their two colours", () => {
    expect(symbolArt("W/U")).toEqual({
      kind: "split",
      glyphs: ["", ""],
      backgrounds: ["#fdfbce", "#bcdaf7"],
      foreground: "#111111",
      scale: 1,
    });
    expect(symbolArt("2/G")).toMatchObject({ glyphs: ["", ""] });
  });

  it("draws Phyrexian mana with the Phyrexian glyph, a little larger", () => {
    expect(symbolArt("G/P")).toMatchObject({ kind: "single", glyph: "", scale: 1.2 });
    expect(symbolArt("G/U/P")).toMatchObject({ kind: "split", glyphs: ["", ""] });
  });

  it("draws untap light on dark, and knows nothing of made-up symbols", () => {
    expect(symbolArt("Q")).toMatchObject({ background: "#111111", foreground: "#ffffff" });
    expect(symbolArt("W/U/B")).toBeNull();
    expect(symbolArt("NOPE")).toBeNull();
  });
});
