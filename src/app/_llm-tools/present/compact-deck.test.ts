import { describe, expect, it } from "vitest";
import {
  compactCardLine,
  groupCompactLines,
  pageCompactGroups,
  shortenOracleText,
  typeGroupOf,
  type CompactLineSource,
} from "./compact-deck";

function line(overrides: Partial<CompactLineSource> = {}): CompactLineSource {
  return {
    name: "Sol Ring",
    board: "main",
    quantity: 1,
    heading: null,
    note: null,
    tags: ["ramp"],
    manaCost: "{1}",
    typeLine: "Artifact",
    text: "{T}: Add {C}{C}.",
    isGameChanger: false,
    isBasicLand: false,
    owned: 1,
    ...overrides,
  };
}

describe("shortenOracleText", () => {
  it("replaces the card's name with ~, drops reminder text and joins abilities", () => {
    expect(
      shortenOracleText(
        "Viscera Seer",
        "Sacrifice a creature: Scry 1. (Look at the top card of your library.)\nViscera Seer can't block.",
      ),
    ).toBe("Sacrifice a creature: Scry 1. • ~ can't block.");
  });

  it("keeps double-faced cards' faces apart and names either face ~", () => {
    expect(
      shortenOracleText("Ojer Kaslem, Deepest Growth // Temple of Cultivation", "unused", [
        "Trample\nWhen Ojer Kaslem, Deepest Growth dies, return it.\nWhenever Ojer Kaslem attacks, draw.",
        "{T}: Add {G}.",
      ]),
    ).toBe("Trample • When ~ dies, return it. • Whenever ~ attacks, draw. // {T}: Add {G}.");
  });
});

describe("compactCardLine", () => {
  it("writes quantity, name, cost, type, tags and text", () => {
    expect(compactCardLine(line(), { includeText: true })).toBe(
      "1 Sol Ring · {1} · Artifact · ramp — {T}: Add {C}{C}.",
    );
  });

  it("adds stats and flags only when they apply, and no text when asked not to", () => {
    expect(
      compactCardLine(
        line({
          name: "Avacyn, Angel of Horror",
          manaCost: "{3}{W}{W}{B}{B}",
          typeLine: "Legendary Creature — Angel",
          printedStats: "8/8",
          tags: [],
          owned: 0,
          isGameChanger: true,
          pinned: true,
          role: "Returns everything that died",
          note: "centerpiece",
        }),
        { includeText: false },
      ),
    ).toBe(
      "1 Avacyn, Angel of Horror · {3}{W}{W}{B}{B} · Legendary Creature — Angel 8/8 · SHORT 1 · GC · PINNED · role: Returns everything that died · note: centerpiece",
    );
  });

  it("never marks basics short and leaves out their text", () => {
    expect(
      compactCardLine(
        line({
          name: "Forest",
          quantity: 6,
          manaCost: null,
          typeLine: "Basic Land — Forest",
          tags: [],
          text: "({T}: Add {G}.)",
          isBasicLand: true,
          owned: 0,
        }),
        { includeText: true },
      ),
    ).toBe("6 Forest · Basic Land — Forest");
  });
});

describe("groupCompactLines", () => {
  it("puts the commander first, then the deck's headings in order, then card types", () => {
    const groups = groupCompactLines(
      [
        line({ name: "Forest", typeLine: "Basic Land — Forest", isBasicLand: true, tags: [] }),
        line({ name: "Llanowar Elves", typeLine: "Creature — Elf Druid", heading: "Ramp" }),
        line({ name: "Henzie", typeLine: "Legendary Creature", board: "commander" }),
        line({ name: "Skullclamp", heading: "Card Draw" }),
      ],
      { byHeading: true, headings: ["Card Draw", "Ramp"], includeText: false },
    );
    expect(groups.map((group) => group.title)).toEqual(["Commander", "Card Draw", "Ramp", "Lands"]);
  });

  it("groups by card type when the deck isn't grouped by heading", () => {
    expect(typeGroupOf("Artifact Creature — Golem")).toBe("Creatures");
    expect(typeGroupOf("Land Creature — Forest Dryad")).toBe("Lands");
    const groups = groupCompactLines([line({ heading: "Ramp" })], {
      byHeading: false,
      headings: ["Ramp"],
      includeText: false,
    });
    expect(groups[0]?.title).toBe("Artifacts");
  });
});

describe("pageCompactGroups", () => {
  const groups = [
    { title: "A", lines: Array.from({ length: 5 }, (_, index) => `a${index} ${"x".repeat(50)}`) },
    { title: "B", lines: Array.from({ length: 5 }, (_, index) => `b${index} ${"x".repeat(50)}`) },
  ];

  it("returns everything on one page when it fits", () => {
    const page = pageCompactGroups(groups, 10_000);
    expect(Object.keys(page.cards)).toEqual(["A", "B"]);
    expect(page.next).toBeUndefined();
    expect(page.totalLines).toBe(10);
  });

  it("stops at a group boundary and resumes from the cursor", () => {
    const first = pageCompactGroups(groups, 400);
    expect(Object.keys(first.cards)).toEqual(["A"]);
    expect(first.next).toBe(5);
    const second = pageCompactGroups(groups, 400, first.next);
    expect(Object.keys(second.cards)).toEqual(["B"]);
    expect(second.next).toBeUndefined();
  });

  it("splits a group only when it alone is bigger than the page", () => {
    const first = pageCompactGroups(groups, 200);
    expect(first.cards.A?.length).toBeGreaterThan(0);
    expect(first.cards.A?.length).toBeLessThan(5);
    const second = pageCompactGroups(groups, 200, first.next);
    expect(Object.keys(second.cards)).toEqual(["A"]);
    expect(second.cards.A?.[0]).toBe(groups[0]?.lines[first.next ?? 0]);
  });
});
