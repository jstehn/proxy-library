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
});
