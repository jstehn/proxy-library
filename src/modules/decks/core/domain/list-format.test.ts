import { describe, expect, it } from "vitest";
import { parseList } from "@/shared/card-search";
import { deckText, EXPORTERS, exportWithHeadings, shortList, type ExportLine } from "./list-format";

describe("exporters (Strategy)", () => {
  const line = (overrides: Partial<ExportLine> & Pick<ExportLine, "name">): ExportLine => ({
    quantity: 1,
    board: "main",
    setCode: null,
    collectorNumber: null,
    heading: null,
    ...overrides,
  });
  const lines: ExportLine[] = [
    line({ name: "Ruby", board: "commander", setCode: "TST", collectorNumber: "7" }),
    line({ name: "Lightning Bolt", quantity: 4, setCode: "M11", collectorNumber: "149" }),
    line({ name: "Duress", quantity: 2, board: "side" }),
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

  it("writes the maybeboard with printings, and leaves it out of names only (design doc 32)", () => {
    const withMaybe = [...lines, line({ name: "Opt", board: "maybe" })];
    expect(EXPORTERS.printings(withMaybe)).toMatch(/\n\nMaybeboard\n1 Opt$/);
    expect(EXPORTERS.names(withMaybe)).toBe(EXPORTERS.names(lines));
  });

  describe("headings (design doc 34)", () => {
    const headed: ExportLine[] = [
      line({ name: "Ruby", board: "commander" }),
      line({ name: "Sol Ring", heading: "Ramp" }),
      line({ name: "Arcane Signet", heading: "Ramp" }),
      line({ name: "Lightning Bolt", quantity: 4, heading: "Removal" }),
      line({ name: "Forest", quantity: 30 }),
      line({ name: "Duress", board: "side", heading: "Removal" }),
    ];

    it("writes headings as blocks in the deck's order, then the rest under Deck", () => {
      expect(exportWithHeadings(headed, ["Removal", "Ramp"])).toBe(
        [
          "Commander\n1 Ruby",
          "Removal (4)\n4 Lightning Bolt",
          "Ramp (2)\n1 Sol Ring\n1 Arcane Signet",
          "Deck\n30 Forest",
          "Sideboard\n1 Duress",
        ].join("\n\n"),
      );
    });

    it("leaves headings out of the plain exports", () => {
      expect(EXPORTERS.names(headed)).not.toMatch(/Ramp|Removal/);
      expect(EXPORTERS.printings(headed)).not.toMatch(/Ramp|Removal/);
    });

    it("reads its own headings back, and no heading for type titles or other boards", () => {
      const text = deckText(
        headed.map((each) => ({ ...each, finish: null })),
        ["Removal", "Ramp"],
      );
      expect(parseList(text).lines.map((each) => [each.name, each.board, each.heading])).toEqual([
        ["Ruby", "commander", null],
        ["Lightning Bolt", "main", "Removal"],
        ["Sol Ring", "main", "Ramp"],
        ["Arcane Signet", "main", "Ramp"],
        ["Forest", "main", null],
        ["Duress", "side", null],
      ]);
      expect(parseList("Creatures (2)\n2 Grizzly Bears").lines[0].heading).toBeNull();
    });
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
    // The deck's own counts: Buy a list leaves out the copies you own (design doc 15, decision 2).
    expect(text).toBe("4 Lightning Bolt\n1 The One Ring *F*");
    // …and the store reads it back the same way.
    expect(parseList(text).lines.map((line) => [line.quantity, line.name, line.finish])).toEqual([
      [4, "Lightning Bolt", null],
      [1, "The One Ring", "foil"],
    ]);
  });
});
