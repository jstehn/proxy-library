import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Format } from "./deck";
import {
  landTarget,
  planManaBase,
  sourceTargets,
  tapped,
  type LandCandidate,
  type ManaBaseInput,
  type ManaBasePlan,
} from "./mana-base";
import { deckStats, type ManaColor } from "./stats";
import type { ProfileLine } from "./suggest";

// A mana base you could start from (design doc 35, sections 3-4).

const spell = (manaCost: string, manaValue: number, quantity = 1): ProfileLine => ({
  quantity,
  manaValue,
  manaCost,
  typeLine: "Creature — Bear",
  board: "main",
});

const land = (name: string, overrides: Partial<LandCandidate> = {}): LandCandidate => ({
  oracleId: name,
  name,
  typeLine: "Land",
  text: "",
  producedMana: [],
  isBasicLand: false,
  ownedCopies: 1,
  alsoIn: [],
  priceCents: null,
  roles: [],
  themes: [],
  ...overrides,
});

const BASIC_NAMES: Readonly<Record<ManaColor | "C", string>> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
  C: "Wastes",
};
const BASICS = Object.entries(BASIC_NAMES).map(([color, name]) =>
  land(name, { typeLine: `Basic Land — ${name}`, producedMana: [color], isBasicLand: true }),
);

/** A land in the deck, as a deck line. */
const deckLand = (producedMana: string[], quantity = 1): ProfileLine => ({
  quantity,
  manaValue: 0,
  typeLine: "Land",
  board: "main",
  producedMana,
});

/** An Azorius Commander deck: 60 spells at mana value 3, as many {W} as {U} symbols. */
const azorius: ProfileLine[] = [spell("{2}{W}", 3, 30), spell("{2}{U}", 3, 30)];

const plan = (overrides: Partial<ManaBaseInput> = {}): ManaBasePlan =>
  planManaBase({
    format: "commander",
    lines: azorius,
    inDeck: new Map(),
    owned: [],
    basics: BASICS,
    store: [],
    deckRoles: [],
    deckThemes: [],
    ...overrides,
  });

const added = (result: ManaBasePlan) =>
  Object.fromEntries(result.add.map((entry) => [entry.card.name, entry.quantity]));
const total = (result: ManaBasePlan) => result.add.reduce((sum, entry) => sum + entry.quantity, 0);

describe("landTarget", () => {
  const target = (format: Format, lines: ProfileLine[]) =>
    landTarget(format, deckStats(lines)).lands;
  const rock = (quantity: number): ProfileLine => ({
    ...spell("{2}", 2, quantity),
    typeLine: "Artifact",
    producedMana: ["C"],
  });

  it("starts from the format's usual count for an average curve", () => {
    expect(target("commander", azorius)).toBe(37);
    expect(landTarget("commander", deckStats([])).reasons).toEqual([{ kind: "base", lands: 37 }]);
  });

  it("moves with the curve", () => {
    expect(target("commander", [spell("{1}{W}", 2, 60)])).toBe(36);
    expect(target("commander", [spell("{2}{W}{W}", 3.5, 60)])).toBe(38);
    expect(target("commander", [spell("{3}{W}{W}", 5, 60)])).toBe(39);
  });

  it("drops a land for each 3 rocks and dorks past 9, at most 3", () => {
    expect(target("commander", [...azorius, rock(11)])).toBe(37);
    expect(target("commander", [...azorius, rock(12)])).toBe(36);
    expect(target("commander", [...azorius, rock(30)])).toBe(34);
  });

  it("keeps limited at 17", () => {
    expect(target("limited", [spell("{4}{G}", 5, 23)])).toBe(17);
  });

  it("gives reasons that add up to the target", () => {
    const result = landTarget("commander", deckStats([spell("{1}{W}", 2, 50), rock(15)]));
    expect(result.reasons.map((reason) => reason.kind)).toEqual([
      "base",
      "lowCurve",
      "manyManaSources",
    ]);
    expect(result.lands).toBe(37 - 1 - 2);
  });
});

describe("sourceTargets", () => {
  const targets = (lines: ProfileLine[], format: Format = "commander") =>
    Object.fromEntries(
      sourceTargets(format, lines, landTarget(format, deckStats(lines))).map((source) => [
        source.color,
        source.target,
      ]),
    );

  it("shares the lands out like the symbols", () => {
    expect(targets(azorius)).toEqual({ W: 19, U: 19 });
  });

  it("aims for at least 10 of a splash color", () => {
    expect(targets([spell("{2}{W}", 3, 58), spell("{2}{U}", 3, 2)])).toEqual({ W: 36, U: 10 });
  });

  it("aims for more of a color a card needs two or three of", () => {
    const splash = [spell("{2}{W}", 3, 58)];
    expect(targets([...splash, spell("{U}{U}", 2)]).U).toBe(15);
    expect(targets([...splash, spell("{U}{U}{U}", 3)]).U).toBe(19);
    expect(targets([...splash, spell("{U}{U}", 2)], "modern").U).toBe(12);
  });

  it("has none for a deck without colored symbols", () => {
    expect(targets([spell("{3}", 3, 60)])).toEqual({});
  });

  it("counts the sources the deck has", () => {
    const lines = [...azorius, deckLand(["W", "U"], 4), deckLand(["W"], 2)];
    const sources = sourceTargets("commander", lines, landTarget("commander", deckStats(lines)));
    expect(sources.map((source) => [source.color, source.have])).toEqual([
      ["W", 6],
      ["U", 4],
    ]);
  });
});

describe("tapped", () => {
  it("reads the rules text", () => {
    expect(tapped("{T}: Add {W} or {U}.")).toBe("never");
    expect(tapped("This land enters tapped.\n{T}: Add {W} or {U}.")).toBe("always");
    expect(tapped("Azorius Chancery enters the battlefield tapped.")).toBe("always");
    expect(tapped("This land enters tapped unless you control a Plains or an Island.")).toBe(
      "sometimes",
    );
    expect(tapped("As this land enters, you may pay 2 life. If you don't, it enters tapped.")).toBe(
      "sometimes",
    );
  });
});

describe("planManaBase", () => {
  const dual = land("Azorius Dual", { producedMana: ["W", "U"] });
  const tappedDual = land("Azorius Tapland", {
    producedMana: ["W", "U"],
    text: "This land enters tapped.",
  });

  it("fills to the target with basics split by the colors' needs", () => {
    const result = plan();
    expect(total(result)).toBe(37);
    expect(added(result)).toEqual({ Plains: 19, Island: 18 });
  });

  it("adds owned non-basics first, then basics", () => {
    const result = plan({ owned: [dual] });
    expect(result.add[0]).toMatchObject({
      card: { name: "Azorius Dual" },
      quantity: 1,
      reasons: [{ kind: "fixes", colors: ["W", "U"] }, { kind: "untapped" }],
    });
    expect(total(result)).toBe(37);
  });

  it("prefers untapped lands, and still takes a tapped dual over a basic", () => {
    const result = plan({ owned: [tappedDual, dual] });
    expect(result.add.map((entry) => entry.card.name).slice(0, 2)).toEqual([
      "Azorius Dual",
      "Azorius Tapland",
    ]);
    expect(result.add[1].tapped).toBe("always");
  });

  it("skips a land that makes none of the deck's colors and does nothing for it", () => {
    const result = plan({ owned: [land("Mountain Dual", { producedMana: ["R", "G"] })] });
    expect(added(result)["Mountain Dual"]).toBeUndefined();
  });

  it("takes a utility land that does what the deck needs", () => {
    const drawLand = land("Library Land", { producedMana: ["C"], roles: ["draw"] });
    expect(added(plan({ owned: [drawLand], deckRoles: ["draw"] }))["Library Land"]).toBe(1);
    expect(added(plan({ owned: [drawLand] }))["Library Land"]).toBeUndefined();
  });

  it("uses every copy you own, even ones other decks play, up to the format's limit", () => {
    const shared = land("Azorius Dual", {
      producedMana: ["W", "U"],
      ownedCopies: 3,
      alsoIn: ["Other deck"],
    });
    expect(added(plan({ owned: [shared] }))["Azorius Dual"]).toBe(1);
    expect(added(plan({ owned: [shared], format: "modern" }))["Azorius Dual"]).toBe(3);
    const inDeck = new Map([["Azorius Dual", 1]]);
    expect(added(plan({ owned: [shared], inDeck }))["Azorius Dual"]).toBeUndefined();
  });

  it("keeps the deck's lands and adds only the rest", () => {
    const result = plan({ lines: [...azorius, deckLand(["W"], 30)] });
    expect(result.lands).toBe(30);
    expect(added(result)).toEqual({ Island: 7 });
  });

  it("adds nothing to a deck over its target, and says by how much", () => {
    const result = plan({ lines: [...azorius, deckLand(["W"], 40)] });
    expect(result.add).toEqual([]);
    expect(result.over).toBe(3);
  });

  it("gives a colorless deck Wastes", () => {
    expect(added(plan({ lines: [spell("{3}", 3, 60)] }))).toEqual({ Wastes: 37 });
  });

  it("lists up to five store lands to consider buying, never added", () => {
    const store = Array.from({ length: 7 }, (_, index) =>
      land(`Store Dual ${index}`, { producedMana: ["W", "U"], priceCents: 100 * (7 - index) }),
    );
    const result = plan({ store });
    expect(result.considerBuying.map((entry) => entry.card.name)).toEqual([
      "Store Dual 6",
      "Store Dual 5",
      "Store Dual 4",
      "Store Dual 3",
      "Store Dual 2",
    ]);
    expect(result.add.every((entry) => !entry.card.name.startsWith("Store"))).toBe(true);
  });

  it("leaves out store lands you own or the deck plays", () => {
    const store = [land("Azorius Dual", { producedMana: ["W", "U"], priceCents: 100 })];
    expect(plan({ owned: [dual], store }).considerBuying).toEqual([]);
  });
});

describe("planManaBase invariants", () => {
  const colors = fc.subarray(["W", "U", "B", "R", "G"] as ManaColor[], { minLength: 0 });
  const candidate = (prefix: string) =>
    fc
      .record({
        index: fc.integer({ min: 0, max: 40 }),
        produced: colors,
        copies: fc.integer({ min: 0, max: 4 }),
        tapped: fc.boolean(),
      })
      .map((value) =>
        land(`${prefix} ${value.index}`, {
          producedMana: value.produced,
          ownedCopies: value.copies,
          text: value.tapped ? "This land enters tapped." : "",
          priceCents: 100,
        }),
      );
  const unique = (cards: LandCandidate[]) => [
    ...new Map(cards.map((card) => [card.oracleId, card])).values(),
  ];
  const deck = fc.record({
    spells: fc.array(
      fc.record({
        color: fc.constantFrom("W", "U", "B", "R", "G", ""),
        count: fc.integer({ min: 1, max: 20 }),
      }),
      { maxLength: 5 },
    ),
    lands: fc.integer({ min: 0, max: 45 }),
    format: fc.constantFrom<Format>("commander", "modern", "limited"),
    owned: fc.array(candidate("Owned"), { maxLength: 20 }).map(unique),
    store: fc.array(candidate("Store"), { maxLength: 20 }).map(unique),
  });

  it("never passes the target, never adds more than you own, keeps store lands apart", () => {
    fc.assert(
      fc.property(deck, (value) => {
        const lines = [
          ...value.spells.map((entry) =>
            spell(entry.color === "" ? "{3}" : `{2}{${entry.color}}`, 3, entry.count),
          ),
          deckLand(["W"], value.lands),
        ];
        const input = {
          format: value.format,
          lines,
          inDeck: new Map<string, number>(),
          owned: value.owned,
          basics: BASICS,
          store: value.store,
          deckRoles: [],
          deckThemes: [],
        };
        const result = planManaBase(input);
        // 1 and 2: exactly up to the target, or nothing when over it.
        expect(result.lands + total(result)).toBe(Math.max(result.lands, result.landTarget.lands));
        // 3: owned copies and the format's limit.
        for (const entry of result.add) {
          if (entry.card.isBasicLand) continue;
          expect(entry.quantity).toBeLessThanOrEqual(entry.card.ownedCopies);
          expect(entry.quantity).toBeLessThanOrEqual(value.format === "commander" ? 1 : 4);
        }
        // 5: store lands only in considerBuying, at most five.
        expect(result.considerBuying.length).toBeLessThanOrEqual(5);
        expect(result.add.some((entry) => entry.card.name.startsWith("Store"))).toBe(false);
        // 9: deterministic.
        expect(planManaBase(input)).toEqual(result);
      }),
    );
  });
});
