import { describe, expect, it } from "vitest";
import { parseList } from "@/shared/card-search";
import { EXPORTERS, shortList } from "./list-format";

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

describe("shortList", () => {
  it("lists what the deck is short of, keeping foil and etched markers", () => {
    const text = shortList(
      [
        { kind: "Short", oracleId: "bolt", name: "Lightning Bolt", needed: 4, owned: 1 },
        { kind: "TooFewCards", minimum: 60, count: 5 },
        { kind: "Short", oracleId: "ring", name: "The One Ring", needed: 1, owned: 0 },
      ],
      [
        { oracleId: "bolt", name: "Lightning Bolt", finish: "nonfoil" },
        { oracleId: "ring", name: "The One Ring", finish: "foil" },
      ],
    );
    expect(text).toBe("3 Lightning Bolt\n1 The One Ring *F*");
    // …and the store reads it back the same way.
    expect(parseList(text).lines.map((line) => [line.quantity, line.name, line.finish])).toEqual([
      [3, "Lightning Bolt", null],
      [1, "The One Ring", "foil"],
    ]);
  });
});
