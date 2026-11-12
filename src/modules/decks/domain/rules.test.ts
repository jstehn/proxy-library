import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { samplePrintingId } from "../testing/fakes";
import { DeckId, withEntry, type Board, type Deck, type Format } from "./deck";
import { canBeCommander, deckProblems, pairProblem, shortCount, type CardRules } from "./rules";

// Small made-up cards, keyed by oracle id.
const legalEverywhere = {
  standard: "legal",
  modern: "legal",
  vintage: "legal",
  commander: "legal",
  pauper: "legal",
};
const CARDS: Record<string, CardRules> = {
  brago: {
    name: "Brago's Favor",
    typeLine: "Conspiracy",
    text: "Hidden agenda",
    colorIdentity: [],
    legalities: {},
    isBasicLand: false,
    hasPowerToughness: false,
  },
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

function deck(format: Format, entries: Array<[string, number, Board?]>): Deck {
  return entries.reduce(
    (built, [oracleId, quantity, board = "main"]) =>
      withEntry(built, { oracleId, board, quantity }),
    {
      id: DeckId.of(1),
      ownerId: UserId.of("jack"),
      name: "Test",
      format,
      usesRealCards: false,
      targetBracket: null,
      grouping: "type",
      headings: [],
      entries: [],
    } as Deck,
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

  it("counts nothing on the maybeboard: not short, not in the size (design doc 32)", () => {
    const owned = (oracleId: string) => (oracleId === "ruby" ? 4 : 0);
    const maybe = deck("standard", [
      ["ruby", 4],
      ["mountain", 56],
      ["lotus", 3, "maybe"],
      ["ruby", 2, "maybe"],
    ]);
    expect(deckProblems(maybe, rules, owned)).toEqual([]);
  });

  it("casual decks have no other rules (rule 4)", () => {
    expect(deckProblems(deck("casual", [["lotus", 7]]), rules, ownAll)).toEqual([]);
  });
});

describe("constructed (rule 2)", () => {
  it("limited needs 40, and a conspiracy in the main deck doesn't count (CR 905.4)", () => {
    const short = deckProblems(
      deck("limited", [
        ["mountain", 39],
        ["brago", 1],
      ]),
      rules,
      ownAll,
    );
    expect(short).toEqual([{ kind: "TooFewCards", minimum: 40, count: 39 }]);
    expect(
      deckProblems(
        deck("limited", [
          ["mountain", 40],
          ["brago", 1],
        ]),
        rules,
        ownAll,
      ),
    ).toEqual([]);
  });

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
    expect(kinds(deckProblems(paired, rules, ownAll))).not.toContain("CommandersCantPair");
    const alone = deck("commander", [
      ["ruby", 1, "commander"],
      ["background", 1, "commander"],
    ]);
    expect(kinds(deckProblems(alone, rules, ownAll))).toContain("CommanderInvalid");
  });

  it("refuses two commanders that don't pair, and only checks pairs (design doc 40)", () => {
    const two = deck("commander", [
      ["ruby", 1, "commander"],
      ["chooser", 1, "commander"],
    ]);
    expect(deckProblems(two, rules, ownAll)).toContainEqual({
      kind: "CommandersCantPair",
      names: ["Ruby Commander", "Background Chooser"],
    });
    expect(kinds(deckProblems(legal, rules, ownAll))).not.toContain("CommandersCantPair");
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

describe("commander pairs (design doc 40, section 2.1)", () => {
  const legend = (name: string, text: string, subtypes = "Human") => ({
    name,
    typeLine: `Legendary Creature — ${subtypes}`,
    text,
  });
  const PARTNER = "Partner (You can have two commanders if both have partner.)";
  const pairs = (a: ReturnType<typeof legend>, b: ReturnType<typeof legend>) =>
    pairProblem([a, b]) === null;

  it("pairs two plain partners, but not a partner with a legend without it", () => {
    expect(pairs(legend("Thrasios", PARTNER), legend("Tymna", `Lifelink\n${PARTNER}`))).toBe(true);
    expect(pairs(legend("Thrasios", PARTNER), legend("Ruby", "Haste"))).toBe(false);
  });

  it("pairs 'Partner with' only with the named card, both ways", () => {
    const pir = legend(
      "Pir, Imaginative Rascal",
      "Partner with Toothy, Imaginary Friend (When this creature enters, target player may put Toothy into their hand from their library.)\nIf one or more counters would be put on a permanent your team controls, that many plus one are put on it instead.",
    );
    const toothy = legend(
      "Toothy, Imaginary Friend",
      "Partner with Pir, Imaginative Rascal\nWhenever you draw a card, put a +1/+1 counter on Toothy.",
    );
    expect(pairs(pir, toothy)).toBe(true);
    expect(pairs(toothy, pir)).toBe(true);
    expect(pairs(pir, legend("Thrasios", PARTNER))).toBe(false);
  });

  it("pairs Partner— variants only when they match", () => {
    const survivor = (name: string) =>
      legend(name, "Partner—Survivors (You can have two commanders if both have this ability.)");
    expect(pairs(survivor("Tyvar"), survivor("Zimone"))).toBe(true);
    expect(
      pairs(
        survivor("Tyvar"),
        legend(
          "Cloud",
          "Partner—Father & Son (You can have two commanders if both have this ability.)",
        ),
      ),
    ).toBe(false);
    expect(pairs(survivor("Tyvar"), legend("Thrasios", PARTNER))).toBe(false);
  });

  it("pairs Friends forever with Friends forever only", () => {
    const friend = (name: string) =>
      legend(name, "Friends forever (You can have two commanders if both have friends forever.)");
    expect(pairs(friend("Will"), friend("Mike"))).toBe(true);
    expect(pairs(friend("Will"), legend("Thrasios", PARTNER))).toBe(false);
  });

  it("pairs a Doctor's companion with a Time Lord Doctor that has no other types", () => {
    const companion = legend(
      "Rose Tyler",
      "Doctor's companion (You can have two commanders if the other is the Doctor.)",
    );
    expect(pairs(companion, legend("The Tenth Doctor", "", "Time Lord Doctor"))).toBe(true);
    expect(pairs(legend("The Tenth Doctor", "", "Time Lord Doctor"), companion)).toBe(true);
    expect(pairs(companion, legend("The Master", "", "Time Lord Rogue"))).toBe(false);
  });

  it("has nothing to say about one commander, or three", () => {
    expect(pairProblem([legend("Ruby", "")])).toBeNull();
    expect(pairProblem([legend("A", ""), legend("B", ""), legend("C", "")])).toBeNull();
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
      {
        oracleId: "bolt",
        board: "main",
        quantity: 4,
        printingId: "p1",
        finish: null,
        heading: null,
      },
    ]);
    expect(withEntry(more, { oracleId: "bolt", board: "main", quantity: 0 }).entries).toEqual([]);
  });
});
