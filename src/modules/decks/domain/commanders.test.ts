import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  colorMask,
  coverageDetails,
  missingCost,
  preparedForTest,
  rankCommanders,
  sharesPlan,
  SPELL_SLOTS,
  withinIdentity,
  type CommanderCandidate,
  type PoolCard,
} from "./commanders";
import type { ManaColor } from "./stats";
import { deckFit, type DeckProfile } from "./suggest";

const commander = (
  name: string,
  overrides: Partial<CommanderCandidate> = {},
): CommanderCandidate => ({
  oracleId: name,
  printingId: name,
  name,
  typeLine: "Legendary Creature — Human",
  text: "",
  colorIdentity: ["G"],
  keywords: [],
  isGameChanger: false,
  ownedCopies: 1,
  priceCents: null,
  leads: [],
  ...overrides,
});

const card = (name: string, overrides: Partial<PoolCard> = {}): PoolCard => ({
  oracleId: name,
  name,
  typeLine: "Creature — Bear",
  manaValue: 2,
  keywords: [],
  roles: [],
  themes: [],
  rarity: "common",
  priceCents: 25,
  pool: "owned",
  colorIdentity: ["G"],
  ...overrides,
});

const many = (count: number, overrides: Partial<PoolCard> = {}, prefix = "Card") =>
  Array.from({ length: count }, (_, index) => card(`${prefix} ${index}`, overrides));

describe("color identity masks", () => {
  it("puts each color in its own bit and ignores colorless", () => {
    expect(colorMask([])).toBe(0);
    expect(colorMask(["W", "U", "B", "R", "G"])).toBe(31);
    expect(colorMask(["C"])).toBe(0);
  });

  it("lets colorless fit every commander, never an off-color card", () => {
    expect(withinIdentity(colorMask([]), colorMask(["G"]))).toBe(true);
    expect(withinIdentity(colorMask(["G"]), colorMask(["G", "W"]))).toBe(true);
    expect(withinIdentity(colorMask(["G", "U"]), colorMask(["G", "W"]))).toBe(false);
  });
});

describe("rankCommanders", () => {
  const tokens = commander("Token Leader", { text: "Whenever a token you control enters, draw." });

  it("counts on-plan cards from a theme, and only on-color ones", () => {
    const pool = [
      card("Maker", { themes: ["tokens"] }),
      card("Blue Maker", { themes: ["tokens"], colorIdentity: ["U"] }),
      card("Bear"),
    ];
    const [coverage] = rankCommanders([tokens], pool, []);
    expect(coverage.plan.themes).toContain("tokens");
    expect(coverage.onPlan).toBe(1);
    expect(coverage.filled).toBe(2);
  });

  it("reads a tribe and a keyword from the commander", () => {
    const elves = commander("Elf Lord", {
      typeLine: "Legendary Creature — Elf Warrior",
      text: "Other Elves you control get +1/+1.",
      keywords: ["Trample"],
    });
    const pool = [
      card("Elf", { typeLine: "Creature — Elf" }),
      card("Trampler", { keywords: ["Trample"] }),
      card("Bear"),
    ];
    const [coverage] = rankCommanders([elves], pool, []);
    expect(coverage.plan.tribes).toEqual(["Elf"]);
    expect(coverage.onPlan).toBe(2);
  });

  it("caps roles at their targets and slots at 62, and never counts lands or the commander", () => {
    const pool = [
      ...many(12, { roles: ["ramp"] }, "Ramp"),
      ...many(60, {}, "Filler"),
      card("Forest Land", { typeLine: "Land" }),
      card("Token Leader", { themes: ["tokens"] }),
    ];
    const [coverage] = rankCommanders([tokens], pool, []);
    expect(coverage.roles.find((role) => role.tag === "ramp")).toEqual({
      tag: "ramp",
      have: 10,
      target: 10,
    });
    expect(coverage.filled).toBe(SPELL_SLOTS);
    expect(coverage.onPlan).toBe(0);
  });

  it("stops counting on-plan cards past 30", () => {
    const thirty = rankCommanders([tokens], many(30, { themes: ["tokens"] }), [])[0];
    const forty = rankCommanders([tokens], many(40, { themes: ["tokens"] }), [])[0];
    expect(forty.onPlan).toBe(40);
    expect(forty.score - thirty.score).toBe(0.5 * 10); // only the filled slots grew
  });

  it("ranks a vanilla legend by roles and slots, with an empty plan", () => {
    const vanilla = commander("Plain Legend");
    const [coverage] = rankCommanders([vanilla], [card("Ramp", { roles: ["ramp"] })], []);
    expect(coverage.plan).toEqual({ themes: [], tribes: [], keywords: [] });
    expect(coverage.score).toBe(1 + 0.5);
  });

  it("orders by score, then owned first, then by name", () => {
    const pool = [card("Maker", { themes: ["tokens"] })];
    const store = commander("A Store Legend", { ownedCopies: 0, priceCents: 300 });
    const ranked = rankCommanders([commander("B Legend"), store, tokens], pool, []);
    expect(ranked.map((coverage) => coverage.commander.name)).toEqual([
      "Token Leader",
      "B Legend",
      "A Store Legend",
    ]);
  });

  it("notes the owned on-color lands", () => {
    const lands = [
      { colorIdentity: ["G"] as ManaColor[] },
      { colorIdentity: ["U"] as ManaColor[] },
    ];
    expect(rankCommanders([tokens], [], lands)[0].ownedLands).toBe(1);
  });

  it("filters by theme, including umbrella themes and specific sub-themes (design doc 39)", () => {
    const votingCommander = commander("Tivit", {
      text: "Council's dilemma — each player votes for evidence or bribery. For each bribery vote, create a Treasure token.",
    });
    const goadCommander = commander("Marisi", {
      text: "Whenever a creature you control deals combat damage to a player, goad each creature that player controls.",
    });
    const candidates = [tokens, votingCommander, goadCommander];
    expect(
      rankCommanders(candidates, [], [], { theme: "politics" }).map(
        (entry) => entry.commander.name,
      ),
    ).toEqual(["Marisi", "Tivit"]);
    expect(
      rankCommanders(candidates, [], [], { theme: "voting" }).map((entry) => entry.commander.name),
    ).toEqual(["Tivit"]);
    expect(
      rankCommanders(candidates, [], [], { theme: "treasures" }).map(
        (entry) => entry.commander.name,
      ),
    ).toEqual(["Tivit"]);
  });

  it("filters by tribe case-insensitively across both plan.tribes and commander subtypes (design doc 39)", () => {
    const elfLord = commander("Ezuri", {
      typeLine: "Legendary Creature — Elf Warrior",
      text: "Other Elf creatures you control get +3/+3.",
    });
    const elfNonLord = commander("Lonis", {
      typeLine: "Legendary Creature — Snake Elf Scout",
      text: "Whenever another nontoken creature you control enters, investigate.",
    });
    const candidates = [tokens, elfLord, elfNonLord];
    expect(
      rankCommanders(candidates, [], [], { tribe: "elf" }).map((entry) => entry.commander.name),
    ).toEqual(["Ezuri", "Lonis"]);
    expect(
      rankCommanders(candidates, [], [], { tribe: "DRAGON" }).map((entry) => entry.commander.name),
    ).toEqual([]);
  });

  it("orders by popularity (edhrecRank ascending, null last), power, and combined (design doc 39)", () => {
    const covered = commander("Covered Legend", {
      text: "Whenever a token you control enters, draw.",
      edhrecRank: 5000,
    });
    const popular = commander("Popular Legend", {
      edhrecRank: 25,
    });
    const powerhouse = commander("Powerhouse Legend", {
      isGameChanger: true,
      rarity: "mythic",
      manaValue: 2,
      roles: ["draw", "ramp"],
      edhrecRank: 150,
    });
    const unranked = commander("Unranked Legend", {
      edhrecRank: null,
    });
    const pool = many(6, { themes: ["tokens"] }, "TokenMaker");
    const candidates = [covered, popular, powerhouse, unranked];

    expect(
      rankCommanders(candidates, pool, [], { sort: "coverage" }).map(
        (entry) => entry.commander.name,
      ),
    ).toEqual(["Covered Legend", "Popular Legend", "Powerhouse Legend", "Unranked Legend"]);

    expect(
      rankCommanders(candidates, pool, [], { sort: "popularity" }).map(
        (entry) => entry.commander.name,
      ),
    ).toEqual(["Popular Legend", "Powerhouse Legend", "Covered Legend", "Unranked Legend"]);

    expect(
      rankCommanders(candidates, pool, [], { sort: "power" }).map((entry) => entry.commander.name),
    ).toEqual(["Powerhouse Legend", "Popular Legend", "Covered Legend", "Unranked Legend"]);

    const combined = rankCommanders(candidates, pool, [], { sort: "combined" });
    // Covered Legend has +20 coverage, Popular Legend has +22.2 popularity, Powerhouse has +18.3 popularity + 0.5*powerScore
    expect(combined[0].commander.name).toBe("Powerhouse Legend");
    expect(combined[combined.length - 1].commander.name).toBe("Unranked Legend");
  });
});

describe("coverageDetails", () => {
  it("lists on-plan cards with reasons and cards per role", () => {
    const tokens = commander("Token Leader", { text: "Create a 1/1 Rabbit token." });
    const pool = [
      card("Maker", { themes: ["tokens"] }),
      card("Cheap Draw", { roles: ["draw"], rarity: "common" }),
      card("Rare Draw", { roles: ["draw"], rarity: "rare" }),
    ];
    const details = coverageDetails(tokens, pool, []);
    expect(details.onPlan.map((entry) => entry.card.name)).toEqual(["Maker"]);
    expect(details.onPlan[0].reasons).toEqual([{ kind: "theme", theme: "tokens" }]);
    expect(details.byRole.draw.map((entry) => entry.name)).toEqual(["Rare Draw", "Cheap Draw"]);
    expect(details.coverage.onPlan).toBe(1);
  });
});

describe("missingCost", () => {
  it("fills short roles with the cheapest store cards, then empty slots with on-plan ones", () => {
    const tokens = commander("Token Leader", { text: "Create a 1/1 Rabbit token." });
    const owned = [
      ...many(10, { roles: ["ramp"] }, "Ramp"),
      ...many(8, { roles: ["removal"] }, "Kill"),
    ];
    const store = [
      ...many(12, { roles: ["draw"], pool: "store", priceCents: 50 }, "Draw"),
      card("Dear Draw", { roles: ["draw"], pool: "store", priceCents: 900 }),
      ...many(3, { roles: ["wipe"], pool: "store", priceCents: 200 }, "Wipe"),
      ...many(40, { themes: ["tokens"], pool: "store", priceCents: 10 }, "Maker"),
      card("Off Color", { themes: ["tokens"], pool: "store", colorIdentity: ["U"], priceCents: 1 }),
      card("No Price", { themes: ["tokens"], pool: "store", priceCents: null }),
    ];
    const [coverage] = rankCommanders([tokens], owned, []);
    const missing = missingCost(coverage, store);
    const fills = (kind: string) => missing.picks.filter((pick) => pick.fills === kind);
    expect(fills("draw")).toHaveLength(10);
    expect(fills("draw").map((pick) => pick.card.name)).not.toContain("Dear Draw");
    expect(fills("wipe")).toHaveLength(3);
    // 62 slots − 18 filled − 13 role picks = 31 on-plan picks
    expect(fills("plan")).toHaveLength(31);
    const names = missing.picks.map((pick) => pick.card.name);
    expect(names).not.toContain("Off Color");
    expect(names).not.toContain("No Price");
    expect(missing.totalCents).toBe(10 * 50 + 3 * 200 + 31 * 10);
  });
});

describe("invariants (design doc 36, section 4)", () => {
  const colors = fc.subarray(["W", "U", "B", "R", "G"] as ManaColor[]);
  const poolCard = fc.record({
    name: fc.constantFrom("A", "B", "C", "D", "E", "F", "G", "H"),
    colorIdentity: colors,
    themes: fc.subarray(["tokens", "counters"] as const),
    roles: fc.subarray(["ramp", "draw", "removal", "wipe"] as const),
    land: fc.boolean(),
  });
  const candidateArbitrary = fc.record({
    name: fc.constantFrom("A", "B", "X", "Y"),
    colorIdentity: colors,
    text: fc.constantFrom("", "Create a 1/1 token.", "Put a +1/+1 counter on it."),
  });

  it("counts only on-color non-land cards, never the commander, within the caps, in a fixed order", () => {
    fc.assert(
      fc.property(
        fc.array(candidateArbitrary, { maxLength: 4 }),
        fc.array(poolCard, { maxLength: 80 }),
        (candidateRows, poolRows) => {
          const candidates = candidateRows.map((row) => commander(row.name, row));
          const pool = poolRows.map((row, index) =>
            card(`${row.name}${index}`, {
              ...row,
              oracleId: index % 7 === 0 ? row.name : `${row.name}${index}`,
              typeLine: row.land ? "Land" : "Creature — Bear",
            }),
          );
          const ranked = rankCommanders(candidates, pool, []);
          for (const coverage of ranked) {
            const mask = colorMask(coverage.commander.colorIdentity);
            const counted = pool.filter(
              (entry) =>
                entry.typeLine !== "Land" &&
                entry.oracleId !== coverage.commander.oracleId &&
                withinIdentity(colorMask(entry.colorIdentity), mask),
            );
            expect(coverage.filled).toBe(Math.min(SPELL_SLOTS, counted.length));
            expect(coverage.onPlan).toBeLessThanOrEqual(counted.length);
            for (const role of coverage.roles) expect(role.have).toBeLessThanOrEqual(role.target);
          }
          expect(rankCommanders(candidates, pool, [])).toEqual(ranked);
          const reversed = rankCommanders([...candidates].reverse(), pool, []);
          expect(reversed.map((entry) => entry.score)).toEqual(ranked.map((entry) => entry.score));
        },
      ),
    );
  });
});

describe("sharesPlan", () => {
  it("agrees with deckFit finding any point", () => {
    const plans = fc.record({
      themes: fc.subarray(["tokens", "counters", "graveyard"] as const),
      tribes: fc.subarray(["Elf", "Rabbit"]),
      keywords: fc.subarray(["Flying", "Trample"]),
    });
    const cards = fc.record({
      themes: fc.subarray(["tokens", "counters", "graveyard"] as const),
      typeLine: fc.constantFrom(
        "Creature — Elf Druid",
        "Creature — Rabbit",
        "Instant",
        "Creature — Bear",
      ),
      keywords: fc.subarray(["Flying", "Trample", "Changeling"]),
    });
    fc.assert(
      fc.property(plans, cards, (planRow, cardRow) => {
        const plan: DeckProfile = { ...planRow, gaps: [] };
        const entry = card("Card", cardRow);
        expect(sharesPlan(preparedForTest(entry), plan)).toBe(deckFit(entry, plan).points > 0);
      }),
    );
  });
});
