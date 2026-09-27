import { describe, expect, it } from "vitest";
import { EXPORTERS, parseList } from "./list-format";

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
      { quantity: 4, name: "Lightning Bolt", setCode: null, collectorNumber: null, board: "main" },
      { quantity: 2, name: "Counterspell", setCode: null, collectorNumber: null, board: "main" },
      { quantity: 1, name: "Sol Ring", setCode: "C21", collectorNumber: "263", board: "main" },
      { quantity: 1, name: "Mountain", setCode: null, collectorNumber: null, board: "main" },
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
});

describe("exporters (Strategy)", () => {
  const lines = [
    {
      quantity: 1,
      name: "Ruby",
      board: "commander" as const,
      setCode: "TST",
      collectorNumber: "7",
    },
    {
      quantity: 4,
      name: "Lightning Bolt",
      board: "main" as const,
      setCode: "M11",
      collectorNumber: "149",
    },
    { quantity: 2, name: "Duress", board: "side" as const, setCode: null, collectorNumber: null },
  ];

  it("writes printings in the format Moxfield and Arena read", () => {
    expect(EXPORTERS.printings(lines)).toBe(
      "Commander\n1 Ruby (TST) 7\n\nDeck\n4 Lightning Bolt (M11) 149\n\nSideboard\n2 Duress",
    );
  });

  it("writes names only, and round-trips through parseList", () => {
    const text = EXPORTERS.names(lines);
    expect(text).toBe("Commander\n1 Ruby\n\nDeck\n4 Lightning Bolt\n\nSideboard\n2 Duress");
    expect(
      parseList(EXPORTERS.printings(lines)).lines.map((line) => [
        line.quantity,
        line.name,
        line.board,
      ]),
    ).toEqual([
      [1, "Ruby", "commander"],
      [4, "Lightning Bolt", "main"],
      [2, "Duress", "side"],
    ]);
  });
});
