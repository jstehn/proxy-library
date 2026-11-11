import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseList } from "./list";

describe("parseList", () => {
  it("reads the common list styles", () => {
    const { lines, unreadable } = parseList(`
      4 Lightning Bolt
      2x Counterspell
      1 Sol Ring (C21) 263
      Mountain
      // a comment
    `);
    expect(unreadable).toEqual([]);
    expect(lines).toEqual([
      {
        quantity: 4,
        name: "Lightning Bolt",
        setCode: null,
        collectorNumber: null,
        finish: null,
        board: "main",
      },
      {
        quantity: 2,
        name: "Counterspell",
        setCode: null,
        collectorNumber: null,
        finish: null,
        board: "main",
      },
      {
        quantity: 1,
        name: "Sol Ring",
        setCode: "C21",
        collectorNumber: "263",
        finish: null,
        board: "main",
      },
      {
        quantity: 1,
        name: "Mountain",
        setCode: null,
        collectorNumber: null,
        finish: null,
        board: "main",
      },
    ]);
  });

  it("switches boards on section headers and SB: lines", () => {
    const { lines } = parseList(
      "Commander\n1 Ruby\n\nDeck\n1 Bolt\nSideboard\n2 Duress\nMain\nSB: 1 Negate",
    );
    expect(lines.map((line) => [line.name, line.board])).toEqual([
      ["Ruby", "commander"],
      ["Bolt", "main"],
      ["Duress", "side"],
      ["Negate", "side"],
    ]);
  });

  it("reports lines it can't read instead of guessing", () => {
    expect(parseList("0 Nothing\n500 Too Many").unreadable).toEqual(["0 Nothing", "500 Too Many"]);
  });

  it("reads Moxfield's foil and etched markers, wherever they are after the name", () => {
    const { lines, unreadable } = parseList(
      "1 Sol Ring (C21) 263 *F*\n2 The One Ring *E*\n1 Opt *f* (XLN) 65\n1 Ponder",
    );
    expect(unreadable).toEqual([]);
    expect(
      lines.map((line) => [line.name, line.setCode, line.collectorNumber, line.finish]),
    ).toEqual([
      ["Sol Ring", "C21", "263", "foil"],
      ["The One Ring", null, null, "etched"],
      ["Opt", "XLN", "65", "foil"],
      ["Ponder", null, null, null],
    ]);
  });

  // Design doc 23: Archidekt and Moxfield export lists grouped under "Category (count)" headings.
  it("reads headings with a count, and category headings switch back to the main board", () => {
    const { lines, unreadable } = parseList(
      [
        "Commander (1)",
        "1 Jolene, the Plunder Queen",
        "Lands (36)",
        "7 Forest",
        "Ramp & Mana Fixers (9)",
        "1 Sol Ring (C21) 263",
        "Sideboard (2)",
        "2 Duress",
        "Commanders (2)",
        "1 Halana and Alena, Partners",
        "Treasure Generators & Multipliers (9)",
        "Lightning Bolt",
      ].join("\n"),
    );
    expect(unreadable).toEqual([]);
    expect(lines.map((line) => [line.name, line.board, line.quantity])).toEqual([
      ["Jolene, the Plunder Queen", "commander", 1],
      ["Forest", "main", 7],
      ["Sol Ring", "main", 1],
      ["Duress", "side", 2],
      ["Halana and Alena, Partners", "commander", 1],
      ["Lightning Bolt", "main", 1],
    ]);
  });

  it("still reads a card line that has a quantity and a set, not a heading", () => {
    const { lines } = parseList("1 Sol Ring (C21) 263\n2 Opt (XLN)");
    expect(lines.map((line) => [line.name, line.setCode])).toEqual([
      ["Sol Ring", "C21"],
      ["Opt", "XLN"],
    ]);
  });

  it("skips maybeboard sections unless asked to keep them (decks, design doc 32)", () => {
    const text = "1 Bolt\nMaybeboard (2)\n1 Shock\nConsidering\n1 Opt\nLands (1)\n1 Forest";
    const skipped = parseList(text);
    expect(skipped.unreadable).toEqual([]);
    expect(skipped.lines.map((line) => line.name)).toEqual(["Bolt", "Forest"]);

    const kept = parseList(text, { keepMaybeboard: true });
    expect(kept.lines.map((line) => [line.name, line.board])).toEqual([
      ["Bolt", "main"],
      ["Shock", "maybe"],
      ["Opt", "maybe"],
      ["Forest", "main"],
    ]);
  });

  it("reads a whole category-grouped Commander list: 1 commander and 99 cards", () => {
    const text = readFileSync("tests/fixtures/lists/archidekt-categories.txt", "utf8");
    const { lines, unreadable } = parseList(text);
    expect(unreadable).toEqual([]);
    const count = (board: string) =>
      lines.filter((line) => line.board === board).reduce((sum, line) => sum + line.quantity, 0);
    expect(count("commander")).toBe(1);
    expect(count("main")).toBe(99);
    expect(lines.some((line) => /\(\d+\)$/.test(line.name))).toBe(false);
  });
});
