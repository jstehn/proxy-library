import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { samplePrintingId } from "../testing/fakes";
import { DeckId, withEntry, type Deck, type Format } from "./deck";
import { canBeCommander, deckProblems, shortCount, type CardRules } from "./rules";

// Small made-up cards, keyed by oracle id.
const legalEverywhere = {
  standard: "legal",
  modern: "legal",
  vintage: "legal",
  commander: "legal",
  pauper: "legal",
};
const CARDS: Record<string, CardRules> = {
  bolt: {
    name: "Lightning Bolt",
    typeLine: "Instant",
    text: "",
    colorIdentity: ["R"],
    legalities: { ...legalEverywhere, standard: "not_legal" },
    isBasicLand: false,
    hasPowerToughness: false,
  },
  mountain: {
    name: "Mountain",
    typeLine: "Basic Land — Mountain",
    text: "",
    colorIdentity: ["R"],
    legalities: legalEverywhere,
    isBasicLand: true,
    hasPowerToughness: false,
  },
  rats: {
    name: "Relentless Rats",
    typeLine: "Creature — Rat",
    text: "A deck can have any number of cards named Relentless Rats.",
    colorIdentity: ["B"],
    legalities: legalEverywhere,
    isBasicLand: false,
    hasPowerToughness: false,
  },
  ruby: {
    name: "Ruby Commander",
    typeLine: "Legendary Creature — Human",
    text: "",
    colorIdentity: ["R"],
    legalities: legalEverywhere,
    isBasicLand: false,
    hasPowerToughness: true,
  },
  planeswalker: {
    name: "Walker",
    typeLine: "Legendary Planeswalker",
    text: "Walker can be your commander.",
    colorIdentity: ["R"],
    legalities: legalEverywhere,
    isBasicLand: false,
    hasPowerToughness: false,
  },
  sorcery: {
    name: "Plain Sorcery",
    typeLine: "Sorcery",
    text: "",
    colorIdentity: [],
    legalities: legalEverywhere,
    isBasicLand: false,
    hasPowerToughness: false,
  },
  lotus: {
    name: "Black Lotus",
    typeLine: "Artifact",
    text: "",
    colorIdentity: [],
    legalities: { vintage: "restricted", commander: "banned" },
    isBasicLand: false,
    hasPowerToughness: false,
  },
  // The real Hearthhull, the Worldseed (Edge of Eternities Commander): a Spacecraft that
  // becomes a creature, and leads the World Shaper precon.
  hearthhull: {
    name: "Hearthhull, the Worldseed",
    typeLine: "Legendary Artifact — Spacecraft",
    text: "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft.)",
    colorIdentity: ["B", "R", "G"],
    legalities: legalEverywhere,
    isBasicLand: false,
    hasPowerToughness: true,
  },
  // A Spacecraft with no power and toughness never becomes a creature.
  station: {
    name: "Orbital Station",
    typeLine: "Legendary Artifact — Spacecraft",
    text: "Station",
    colorIdentity: [],
    legalities: legalEverywhere,
    isBasicLand: false,
    hasPowerToughness: false,
  },
  chooser: {
    name: "Background Chooser",
    typeLine: "Legendary Creature — Elf",
    text: "Choose a Background (You can have a Background as a second commander.)",
    colorIdentity: ["G"],
    legalities: legalEverywhere,
    isBasicLand: false,
    hasPowerToughness: true,
  },
  background: {
    name: "Noble Heritage",
    typeLine: "Legendary Enchantment — Background",
    text: "Commander creatures you own get +1/+1.",
    colorIdentity: ["W"],
    legalities: legalEverywhere,
    isBasicLand: false,
    hasPowerToughness: false,
  },
};
const rules = (oracleId: string) => CARDS[oracleId];
const ownAll = () => 99;

function deck(
  format: Format,
  entries: Array<[string, number, ("main" | "side" | "commander")?]>,
): Deck {
  return entries.reduce(
    (built, [oracleId, quantity, board = "main"]) =>
      withEntry(built, { oracleId, board, quantity }),
    { id: DeckId.of(1), ownerId: UserId.of("jack"), name: "Test", format, entries: [] } as Deck,
  );
}

const kinds = (problems: { kind: string }[]) => problems.map((problem) => problem.kind);

describe("ownership (rule 1)", () => {
  it("reports each card you're short of, across boards, but never basic lands", () => {
    const owned = (oracleId: string) => (oracleId === "bolt" ? 3 : 0);
    const problems = deckProblems(
      deck("casual", [
        ["bolt", 4],
        ["bolt", 1, "side"],
        ["mountain", 20],
      ]),
      rules,
      owned,
    );
    expect(problems).toEqual([
      { kind: "Short", oracleId: "bolt", name: "Lightning Bolt", needed: 5, owned: 3 },
    ]);
    expect(shortCount(problems)).toBe(2);
  });

  it("casual decks have no other rules (rule 4)", () => {
    expect(deckProblems(deck("casual", [["lotus", 7]]), rules, ownAll)).toEqual([]);
  });
});

describe("constructed (rule 2)", () => {
  it("needs 60 cards, at most 15 in the sideboard", () => {
    const problems = deckProblems(
      deck("modern", [
        ["mountain", 59],
        ["sorcery", 4, "side"],
        ["bolt", 4, "side"],
        ["rats", 8, "side"],
      ]),
      rules,
      ownAll,
    );
    expect(problems).toEqual([
      { kind: "TooFewCards", minimum: 60, count: 59 },
      { kind: "SideboardTooBig", maximum: 15, count: 16 },
    ]);
  });

  it("allows 4 copies, counting main and side together, except basics and 'any number' cards", () => {
    const ok = deck("modern", [
      ["mountain", 30],
      ["rats", 26],
      ["bolt", 4],
    ]);
    expect(deckProblems(ok, rules, ownAll)).toEqual([]);
    const tooMany = withEntry(ok, { oracleId: "bolt", board: "side", quantity: 1 });
    expect(deckProblems(tooMany, rules, ownAll)).toEqual([
      { kind: "TooManyCopies", name: "Lightning Bolt", maximum: 4, count: 5 },
    ]);
  });

  it("uses the format's legality, with restricted cards limited to one", () => {
    expect(
      kinds(
        deckProblems(
          deck("standard", [
            ["mountain", 56],
            ["bolt", 4],
          ]),
          rules,
          ownAll,
        ),
      ),
    ).toEqual(["NotLegal"]);
    expect(
      deckProblems(
        deck("vintage", [
          ["mountain", 59],
          ["lotus", 1],
        ]),
        rules,
        ownAll,
      ),
    ).toEqual([]);
    expect(
      deckProblems(
        deck("vintage", [
          ["mountain", 58],
          ["lotus", 2],
        ]),
        rules,
        ownAll,
      ),
    ).toEqual([{ kind: "TooManyCopies", name: "Black Lotus", maximum: 1, count: 2 }]);
  });
});

describe("commander (rule 3)", () => {
  const legal = deck("commander", [
    ["ruby", 1, "commander"],
    ["mountain", 98],
    ["bolt", 1],
  ]);

  it("accepts 100 cards with a legendary creature in command, singleton", () => {
    expect(deckProblems(legal, rules, ownAll)).toEqual([]);
  });

  it("needs a commander, and exactly 100 cards", () => {
    const problems = deckProblems(
      deck("commander", [
        ["mountain", 98],
        ["bolt", 1],
      ]),
      rules,
      ownAll,
    );
    expect(kinds(problems)).toEqual(["CommanderMissing", "WrongSize"]);
  });

  it("allows 'can be your commander', refuses other commanders", () => {
    const walker = deck("commander", [
      ["planeswalker", 1, "commander"],
      ["mountain", 99],
    ]);
    expect(deckProblems(walker, rules, ownAll)).toEqual([]);
    const sorcery = deck("commander", [
      ["sorcery", 1, "commander"],
      ["mountain", 99],
    ]);
    expect(kinds(deckProblems(sorcery, rules, ownAll))).toContain("CommanderInvalid");
  });

  it("accepts a legendary Spacecraft or Vehicle with power and toughness (since 2025)", () => {
    expect(canBeCommander(rules("hearthhull"))).toBe(true);
    expect(canBeCommander(rules("station"))).toBe(false);
  });

  it("accepts a Background only beside a commander that chooses one", () => {
    const paired = deck("commander", [
      ["chooser", 1, "commander"],
      ["background", 1, "commander"],
    ]);
    expect(kinds(deckProblems(paired, rules, ownAll))).not.toContain("CommanderInvalid");
    const alone = deck("commander", [
      ["ruby", 1, "commander"],
      ["background", 1, "commander"],
    ]);
    expect(kinds(deckProblems(alone, rules, ownAll))).toContain("CommanderInvalid");
  });

  it("is singleton, keeps to the commander's colors, and follows commander bans", () => {
    const problems = deckProblems(
      withEntry(withEntry(legal, { oracleId: "bolt", board: "main", quantity: 2 }), {
        oracleId: "rats",
        board: "main",
        quantity: 1,
      }),
      rules,
      ownAll,
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        { kind: "TooManyCopies", name: "Lightning Bolt", maximum: 1, count: 2 },
        { kind: "OutsideColorIdentity", name: "Relentless Rats" },
      ]),
    );
    const banned = deck("commander", [
      ["ruby", 1, "commander"],
      ["mountain", 98],
      ["lotus", 1],
    ]);
    expect(deckProblems(banned, rules, ownAll)).toEqual([
      { kind: "NotLegal", name: "Black Lotus", status: "banned" },
    ]);
  });
});

describe("withEntry", () => {
  it("sets, replaces and removes entries, keeping a pinned printing", () => {
    const one = withEntry(deck("casual", []), {
      oracleId: "bolt",
      board: "main",
      quantity: 2,
      printingId: samplePrintingId("p1"),
    });
    const more = withEntry(one, { oracleId: "bolt", board: "main", quantity: 4 });
    expect(more.entries).toEqual([
      { oracleId: "bolt", board: "main", quantity: 4, printingId: "p1", finish: null },
    ]);
    expect(withEntry(more, { oracleId: "bolt", board: "main", quantity: 0 }).entries).toEqual([]);
  });
});
