import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  budgetPicks,
  creatureTypes,
  deckProfile,
  plural,
  rank,
  scoreForDeck,
  scoreForRole,
  scoreLike,
  type CandidateCard,
  type DeckProfile,
  type ProfileLine,
  type Scored,
} from "./suggest";

const candidate = (name: string, overrides: Partial<CandidateCard> = {}): CandidateCard => ({
  oracleId: name,
  name,
  typeLine: "Creature — Elf Druid",
  manaValue: 2,
  keywords: [],
  roles: [],
  themes: [],
  rarity: "common",
  priceCents: 25,
  pool: "store",
  ...overrides,
});

const line = (overrides: Partial<ProfileLine>): ProfileLine => ({
  quantity: 1,
  manaValue: 2,
  typeLine: "Creature — Elf",
  board: "main",
  text: "",
  ...overrides,
});

const EMPTY: DeckProfile = { themes: [], tribes: [], gaps: [], keywords: [] };

describe("creature types and plurals", () => {
  it("reads the front face's creature types only", () => {
    expect(creatureTypes("Legendary Creature — Elf Warrior")).toEqual(["Elf", "Warrior"]);
    expect(creatureTypes("Kindred Instant — Elf")).toEqual(["Elf"]);
    expect(creatureTypes("Artifact — Equipment")).toEqual([]);
    expect(creatureTypes("Instant // Creature — Elf")).toEqual([]);
  });
  it("makes the plurals rules text uses", () => {
    expect(["Elf", "Rabbit", "Mouse", "Fox", "Ally"].map(plural)).toEqual([
      "Elves",
      "Rabbits",
      "Mice",
      "Foxes",
      "Allies",
    ]);
  });
});

describe("deckProfile", () => {
  it("takes themes and a tribe from the commander, and keywords", () => {
    const profile = deckProfile(
      [
        line({
          board: "commander",
          typeLine: "Legendary Creature — Elf Warrior",
          text: "Other Elves you control get +1/+1. Whenever you sacrifice another creature, put a +1/+1 counter on target creature.",
          keywords: ["Trample"],
        }),
      ],
      "commander",
    );
    expect(profile.themes).toEqual(["counters", "sacrifice"]);
    expect(profile.tribes).toEqual(["Elf"]);
    expect(profile.keywords).toEqual(["Trample"]);
  });

  it("adds themes and tribes most of the deck already has, and the roles it's short of", () => {
    const lines = [
      line({
        quantity: 6,
        typeLine: "Creature — Rabbit Soldier",
        text: "When this enters, create a 1/1 Rabbit creature token.",
      }),
      line({ quantity: 4, typeLine: "Creature — Bird", text: "Flying" }),
      line({ quantity: 1, typeLine: "Instant", text: "Destroy target creature." }),
      line({ quantity: 20, typeLine: "Basic Land — Plains", manaValue: 0 }),
    ];
    // Only Commander has role targets, so only a Commander deck can be short of a role.
    expect(deckProfile(lines, "standard").gaps).toEqual([]);
    expect(deckProfile(lines, "commander").gaps.map((gap) => gap.tag)).toEqual([
      "ramp",
      "draw",
      "removal",
      "wipe",
    ]);
  });

  it("finds themes and tribes in a deck without a commander", () => {
    const profile = deckProfile(
      [
        line({
          quantity: 6,
          typeLine: "Creature — Rabbit Soldier",
          text: "When this enters, create a 1/1 Rabbit creature token.",
        }),
        line({ quantity: 4, typeLine: "Creature — Bird", text: "Flying" }),
        line({ quantity: 1, typeLine: "Instant", text: "Destroy target creature." }),
        line({ quantity: 20, typeLine: "Basic Land — Plains", manaValue: 0 }),
      ],
      "standard",
    );
    expect(profile.themes).toEqual(["tokens"]);
    // 6 of 10 creatures are Rabbit Soldiers: both types count, as the rule says.
    expect(profile.tribes).toEqual(["Rabbit", "Soldier"]);
  });
});

describe("scoring", () => {
  const profile: DeckProfile = {
    themes: ["counters"],
    tribes: ["Elf"],
    gaps: [{ tag: "removal", count: 2, target: 8 }],
    keywords: ["Trample"],
  };

  it("adds up themes, tribes, gaps and keywords, with reasons", () => {
    const scored = scoreForDeck(
      candidate("Elf Bruiser", { themes: ["counters"], roles: ["removal"], keywords: ["Trample"] }),
      profile,
    );
    expect(scored?.reasons).toEqual([
      { kind: "theme", theme: "counters" },
      { kind: "tribe", tribe: "Elf" },
      { kind: "role", tag: "removal", count: 2, target: 8 },
      { kind: "keyword", keyword: "Trample" },
    ]);
    // 9 points, plus a sliver of strength: a 25¢ common.
    expect(scored?.score).toBeGreaterThan(9);
    expect(scored?.score).toBeLessThan(9.1);
  });

  it("never suggests a card for strength alone, and counts changelings in every tribe", () => {
    expect(
      scoreForDeck(
        candidate("Pricey", { typeLine: "Artifact", rarity: "mythic", priceCents: 9000 }),
        profile,
      ),
    ).toBeNull();
    expect(
      scoreForDeck(
        candidate("Shapeshifter", {
          typeLine: "Creature — Shapeshifter",
          keywords: ["Changeling"],
        }),
        profile,
      )?.reasons,
    ).toEqual([{ kind: "tribe", tribe: "Elf" }]);
  });

  it("scores a role on request, first reason the role", () => {
    const scored = scoreForRole(
      candidate("Murder", { typeLine: "Instant", roles: ["removal"] }),
      "removal",
      EMPTY,
    );
    expect(scored?.reasons).toEqual([
      { kind: "role", tag: "removal", count: undefined, target: undefined },
    ]);
    expect(scoreForRole(candidate("Bear", { roles: [] }), "removal", EMPTY)).toBeNull();
    // Other roles the deck lacks don't lift a card in this role's list.
    const short: DeckProfile = {
      ...EMPTY,
      gaps: [
        { tag: "draw", count: 0, target: 10 },
        { tag: "removal", count: 0, target: 8 },
      ],
    };
    const both = scoreForRole(candidate("Both", { roles: ["removal", "draw"] }), "removal", short);
    const one = scoreForRole(candidate("One", { roles: ["removal"] }), "removal", short);
    expect(both?.score).toBeCloseTo(one?.score ?? 0);
    expect(both?.reasons).toEqual([{ kind: "role", tag: "removal", count: 0, target: 8 }]);
  });

  it("finds cards like another by shared jobs, not by type alone", () => {
    const target = candidate("Llanowar Elves", { roles: ["ramp"], manaValue: 1 });
    expect(
      scoreLike(candidate("Elvish Mystic", { roles: ["ramp"], manaValue: 1 }), target)?.reasons,
    ).toEqual([
      { kind: "role", tag: "ramp" },
      { kind: "tribe", tribe: "Elf" },
      { kind: "tribe", tribe: "Druid" },
    ]);
    expect(scoreLike(candidate("Bear", { typeLine: "Creature — Bear" }), target)).toBeNull();
    expect(scoreLike(target, target)).toBeNull();
  });

  it("ranks by score, owned first at a tie, then by name", () => {
    const a = { card: candidate("B store"), score: 3, reasons: [] };
    const b = { card: candidate("C owned", { pool: "owned" }), score: 3, reasons: [] };
    const c = { card: candidate("A best"), score: 5, reasons: [] };
    expect(rank([a, null, b, c]).map((entry) => entry.card.name)).toEqual([
      "A best",
      "C owned",
      "B store",
    ]);
  });
});

describe("budgetPicks (invariant 5)", () => {
  const scored = (
    name: string,
    score: number,
    priceCents: number | null,
    pool: "owned" | "store" = "store",
  ): Scored => ({
    card: candidate(name, { priceCents, pool }),
    score,
    reasons: [],
  });

  it("takes the best value first, skips what no longer fits, counts cheap cards as $1", () => {
    const picks = budgetPicks(
      [
        scored("Great", 9, 300), // 3 points a dollar
        scored("Cheap filler", 2, 10), // 2 a dollar (10¢ counts as $1)
        scored("Expensive", 10, 1500), // 0.67 a dollar
        scored("Fine", 6, 200), // 3 a dollar
        scored("Owned", 50, 100, "owned"),
        scored("No price", 50, null),
      ],
      600,
      15,
    );
    expect(picks.map((pick) => pick.card.name)).toEqual(["Great", "Fine", "Cheap filler"]);
  });

  it("never goes over the budget, repeats a card, or picks more than asked", () => {
    const entry = fc.record({
      name: fc.constantFrom("a", "b", "c", "d", "e", "f"),
      score: fc.double({ min: 0.1, max: 20, noNaN: true }),
      price: fc.integer({ min: 1, max: 5000 }),
      owned: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(entry),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 8 }),
        (entries, budget, most) => {
          const picks = budgetPicks(
            entries.map((one) =>
              scored(one.name, one.score, one.price, one.owned ? "owned" : "store"),
            ),
            budget,
            most,
          );
          const spent = picks.reduce((sum, pick) => sum + (pick.card.priceCents ?? 0), 0);
          expect(spent).toBeLessThanOrEqual(budget);
          expect(picks.length).toBeLessThanOrEqual(most);
          expect(new Set(picks.map((pick) => pick.card.oracleId)).size).toBe(picks.length);
          expect(picks.every((pick) => pick.card.pool === "store")).toBe(true);
        },
      ),
    );
  });
});
