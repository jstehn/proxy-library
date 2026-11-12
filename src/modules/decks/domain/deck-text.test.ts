import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Finish } from "@/modules/catalog";
import { parseList } from "@/shared/card-search";
import { samplePrintingId } from "../testing/fakes";
import { BOARDS, replacedEntries, type DeckEntry, type MatchedLine } from "./deck";
import { deckText, fingerprint, type DeckTextLine } from "./list-format";

// Design doc 23: editing a deck as text.

const bolt = "oracle-bolt";
const ring = "oracle-ring";

function matched(overrides: Partial<MatchedLine> & Pick<MatchedLine, "oracleId">): MatchedLine {
  return {
    board: "main",
    quantity: 1,
    printingId: samplePrintingId(`${overrides.oracleId}-special`),
    finish: "foil",
    namesPrinting: false,
    finishMarker: null,
    heading: null,
    ...overrides,
  };
}

describe("replacedEntries", () => {
  const current: DeckEntry[] = [
    {
      oracleId: bolt,
      board: "main",
      quantity: 4,
      printingId: samplePrintingId("bolt-m11"),
      finish: "nonfoil",
      heading: null,
      note: null,
    },
    {
      oracleId: ring,
      board: "main",
      quantity: 1,
      printingId: null,
      finish: null,
      heading: null,
      note: null,
    },
  ];

  it("holds exactly the list's cards: cards not in it are removed", () => {
    const entries = replacedEntries(current, [matched({ oracleId: bolt, quantity: 3 })]);
    expect(entries.map((entry) => [entry.oracleId, entry.quantity])).toEqual([[bolt, 3]]);
  });

  it("keeps the printing and finish a card already had when the line names none", () => {
    const [entry] = replacedEntries(current, [matched({ oracleId: bolt })]);
    expect(entry).toMatchObject({ printingId: "bolt-m11", finish: "nonfoil" });
    // Unpinned stays unpinned, so the deck view keeps choosing the most special copy.
    const [unpinned] = replacedEntries(current, [matched({ oracleId: ring })]);
    expect(unpinned).toMatchObject({ printingId: null, finish: null });
  });

  it("uses a named printing, and keeps the finish when it's the printing already pinned", () => {
    const [other] = replacedEntries(current, [
      matched({ oracleId: bolt, printingId: samplePrintingId("bolt-2x2"), namesPrinting: true }),
    ]);
    expect(other).toMatchObject({ printingId: "bolt-2x2", finish: "foil" });
    const [same] = replacedEntries(current, [
      matched({ oracleId: bolt, printingId: samplePrintingId("bolt-m11"), namesPrinting: true }),
    ]);
    expect(same).toMatchObject({ printingId: "bolt-m11", finish: "nonfoil" });
  });

  it("lets a finish marker win", () => {
    const [entry] = replacedEntries(current, [matched({ oracleId: bolt, finishMarker: "etched" })]);
    expect(entry).toMatchObject({ printingId: "bolt-m11", finish: "etched" });
  });

  it("gives a new card the version the catalog chose (your most special copy)", () => {
    const [entry] = replacedEntries([], [matched({ oracleId: "oracle-new" })]);
    expect(entry).toMatchObject({ printingId: "oracle-new-special", finish: "foil" });
  });

  it("adds up two lines for one card on one board, at most 99, and keeps boards apart", () => {
    const entries = replacedEntries(
      [],
      [
        matched({ oracleId: "forest", quantity: 60 }),
        matched({ oracleId: "forest", quantity: 60 }),
        matched({ oracleId: "forest", board: "side", quantity: 2 }),
      ],
    );
    expect(entries.map((entry) => [entry.board, entry.quantity])).toEqual([
      ["main", 99],
      ["side", 2],
    ]);
  });
});

describe("deckText", () => {
  it("writes sections, pinned printings and foil/etched markers", () => {
    const lines: DeckTextLine[] = [
      {
        quantity: 1,
        name: "Jolene, the Plunder Queen",
        board: "commander",
        setCode: null,
        collectorNumber: null,
        finish: "foil",
        heading: null,
      },
      {
        quantity: 7,
        name: "Forest",
        board: "main",
        setCode: null,
        collectorNumber: null,
        finish: null,
        heading: null,
      },
      {
        quantity: 1,
        name: "Sol Ring",
        board: "main",
        setCode: "C21",
        collectorNumber: "263",
        finish: "etched",
        heading: null,
      },
      {
        quantity: 1,
        name: "Opt",
        board: "side",
        setCode: "XLN",
        collectorNumber: "65",
        finish: "nonfoil",
        heading: null,
      },
    ];
    expect(deckText(lines)).toBe(
      [
        "Commander",
        "1 Jolene, the Plunder Queen *F*",
        "",
        "Deck",
        "7 Forest",
        "1 Sol Ring (C21) 263 *E*",
        "",
        "Sideboard",
        "1 Opt (XLN) 65",
      ].join("\n"),
    );
  });
});

describe("fingerprint", () => {
  const entries: DeckEntry[] = [
    {
      oracleId: bolt,
      board: "main",
      quantity: 4,
      printingId: samplePrintingId("bolt-m11"),
      finish: "nonfoil",
      heading: null,
      note: null,
    },
    {
      oracleId: ring,
      board: "side",
      quantity: 1,
      printingId: null,
      finish: null,
      heading: null,
      note: null,
    },
  ];

  it("doesn't depend on the order entries are stored in", () => {
    expect(fingerprint([...entries].reverse())).toBe(fingerprint(entries));
  });

  it("changes when a quantity, board, printing or finish does", () => {
    const [first, second] = entries;
    const changes: DeckEntry[] = [
      { ...first, quantity: 3 },
      { ...first, board: "side" },
      { ...first, printingId: samplePrintingId("bolt-2x2") },
      { ...first, finish: "foil" },
    ];
    for (const changed of changes) {
      expect(fingerprint([changed, second])).not.toBe(fingerprint(entries));
    }
  });
});

// Invariant 3: saving the text the box started with, unchanged, leaves the deck as it was. The
// "catalog" here matches names and printings back the way `cards.resolve` does, and always picks
// a foil special copy for unnamed lines, so a wrongly re-chosen version would show.
describe("round trip: deck → text → parse → replace", () => {
  const FINISHES: Finish[] = ["nonfoil", "foil", "etched"];
  const entry = fc.record({
    card: fc.integer({ min: 1, max: 30 }),
    board: fc.constantFrom(...BOARDS),
    quantity: fc.integer({ min: 1, max: 99 }),
    printing: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
    finish: fc.option(fc.constantFrom(...FINISHES), { nil: null }),
    heading: fc.option(fc.constantFrom("Ramp", "Removal", "Win conditions"), { nil: null }),
    note: fc.option(fc.constantFrom("Combo piece", "Budget ramp", "Meta call"), { nil: null }),
  });
  // One entry per card per board, as a deck has (invariant 9).
  const deck = fc.uniqueArray(entry, {
    selector: (generated) => `${generated.board}:${generated.card}`,
    maxLength: 40,
  });

  it("gives back the same entries", () => {
    fc.assert(
      fc.property(deck, (generated) => {
        const entries: DeckEntry[] = generated.map((each) => ({
          oracleId: `oracle-${each.card}`,
          board: each.board,
          quantity: each.quantity,
          printingId:
            each.printing === null ? null : samplePrintingId(`p-${each.card}-${each.printing}`),
          finish: each.finish,
          heading: each.heading,
          note: each.note,
        }));
        const text = deckText(
          generated.map((each) => ({
            quantity: each.quantity,
            name: `Card Number ${each.card}`,
            board: each.board,
            setCode: each.printing === null ? null : `S${each.printing}X`,
            collectorNumber: each.printing === null ? null : String(each.card),
            finish: each.finish,
            heading: each.heading,
          })),
          // Grouped by its own headings (design doc 34): every heading the deck has, in order.
          [...new Set(generated.flatMap((each) => (each.heading === null ? [] : [each.heading])))],
        );

        const parsed = parseList(text, { keepMaybeboard: true });
        expect(parsed.unreadable).toEqual([]);
        const lines: MatchedLine[] = parsed.lines.map((line) => {
          const card = Number(/\d+$/.exec(line.name)?.[0]);
          const printing = line.setCode === null ? null : Number(line.setCode.slice(1, -1));
          return {
            oracleId: `oracle-${card}`,
            board: line.board,
            quantity: line.quantity,
            printingId: samplePrintingId(
              printing === null ? `special-${card}` : `p-${card}-${printing}`,
            ),
            finish: "foil",
            namesPrinting: printing !== null,
            finishMarker: line.finish,
            heading: line.heading,
          };
        });

        const sorted = (list: readonly DeckEntry[]) =>
          [...list].sort((a, b) =>
            `${a.board}${a.oracleId}`.localeCompare(`${b.board}${b.oracleId}`),
          );
        expect(sorted(replacedEntries(entries, lines))).toEqual(sorted(entries));
      }),
    );
  });
});
