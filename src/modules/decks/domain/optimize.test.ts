import { describe, expect, it } from "vitest";
import { seededRng } from "@/shared/kernel";
import { optimizeDeck, scoreDeck, type OptimizerCard } from "./optimize";

function makeCard(
  overrides: Partial<OptimizerCard> & { oracleId: string; name: string },
): OptimizerCard {
  return {
    typeLine: "Creature — Elf",
    manaValue: 2,
    manaCost: "{1}{G}",
    text: "",
    producedMana: [],
    keywords: [],
    roles: [],
    themes: [],
    rarity: "common",
    priceCents: 100,
    board: "main",
    quantity: 1,
    ...overrides,
  };
}

function makeCommanderDeck(): OptimizerCard[] {
  const cards: OptimizerCard[] = [
    makeCard({
      oracleId: "cmd-1",
      name: "Lathril, Blade of the Elves",
      typeLine: "Legendary Creature — Elf Noble",
      manaValue: 4,
      manaCost: "{2}{B}{G}",
      text: "Whenever Lathril deals combat damage to a player, create that many 1/1 green Elf Warrior creature tokens.",
      roles: [],
      themes: ["tokens"],
      board: "commander",
      rarity: "mythic",
    }),
  ];
  for (let i = 0; i < 36; i++) {
    cards.push(
      makeCard({
        oracleId: `land-${i}`,
        name: `Forest ${i}`,
        typeLine: "Basic Land — Forest",
        manaValue: 0,
        manaCost: null,
        producedMana: ["G"],
        priceCents: 10,
      }),
    );
  }
  // Weak high-MV vanilla fillers that should be replaced.
  for (let i = 0; i < 6; i++) {
    cards.push(
      makeCard({
        oracleId: `filler-${i}`,
        name: `Vanilla Giant ${i}`,
        typeLine: "Creature — Giant",
        manaValue: 7,
        manaCost: "{6}{G}",
        text: "",
        priceCents: 10,
      }),
    );
  }
  // Core elves.
  for (let i = 0; i < 8; i++) {
    cards.push(
      makeCard({
        oracleId: `elf-${i}`,
        name: `Llanowar Scout ${i}`,
        typeLine: "Creature — Elf",
        manaValue: 2,
        manaCost: "{1}{G}",
        text: "{T}: Add {G}.",
        producedMana: ["G"],
        roles: ["ramp"],
        priceCents: 50,
      }),
    );
  }
  return cards;
}

describe("scoreDeck", () => {
  it("scores a balanced role-covering deck higher than a top-heavy filler deck", () => {
    const base = makeCommanderDeck();
    const better = base.map((c) =>
      c.oracleId === "filler-0"
        ? makeCard({
            oracleId: "good-draw",
            name: "Harmonize",
            typeLine: "Sorcery",
            manaValue: 4,
            manaCost: "{2}{G}{G}",
            text: "Draw three cards.",
            roles: ["draw"],
            edhrec: { inclusionRate: 0.4, synergy: 0.2 },
          })
        : c,
    );

    const baseScore = scoreDeck(base, { format: "commander", targetBracket: 2 });
    const betterScore = scoreDeck(better, { format: "commander", targetBracket: 2 });

    expect(betterScore.total).toBeGreaterThan(baseScore.total);
    expect(betterScore.roleCoverage).toBeGreaterThan(baseScore.roleCoverage);
  });

  it("applies bracketPenalty when a Game Changer exceeds targetBracket 2", () => {
    const deck = makeCommanderDeck();
    deck.push(
      makeCard({
        oracleId: "gc-1",
        name: "Demonic Tutor",
        typeLine: "Sorcery",
        manaValue: 2,
        manaCost: "{1}{B}",
        text: "Search your library for a card.",
        isGameChanger: true,
      }),
    );

    const score = scoreDeck(deck, { format: "commander", targetBracket: 2 });
    expect(score.bracketPenalty).toBeGreaterThan(0);
    expect(score.metrics.gameChangerCount).toBe(1);
  });
});

describe("optimizeDeck", () => {
  const candidates: OptimizerCard[] = [
    makeCard({
      oracleId: "add-draw-1",
      name: "Beast Whisperer",
      typeLine: "Creature — Elf Druid",
      manaValue: 4,
      manaCost: "{2}{G}{G}",
      text: "Whenever you cast a creature spell, draw a card.",
      roles: ["draw"],
      edhrec: { inclusionRate: 0.55, synergy: 0.35 },
      priceCents: 200,
    }),
    makeCard({
      oracleId: "add-draw-2",
      name: "Sylvan Library",
      typeLine: "Enchantment",
      manaValue: 2,
      manaCost: "{1}{G}",
      text: "At the beginning of your draw step, you may draw two additional cards.",
      roles: ["draw"],
      edhrec: { inclusionRate: 0.45, synergy: 0.25 },
      priceCents: 2500,
    }),
    makeCard({
      oracleId: "add-removal-1",
      name: "Beast Within",
      typeLine: "Instant",
      manaValue: 3,
      manaCost: "{2}{G}",
      text: "Destroy target permanent. Its controller creates a 3/3 green Beast creature token.",
      roles: ["removal"],
      edhrec: { inclusionRate: 0.65, synergy: 0.15 },
      priceCents: 150,
    }),
    makeCard({
      oracleId: "add-ramp-1",
      name: "Cultivate",
      typeLine: "Sorcery",
      manaValue: 3,
      manaCost: "{2}{G}",
      text: "Search your library for up to two basic land cards.",
      roles: ["ramp"],
      edhrec: { inclusionRate: 0.6, synergy: 0.1 },
      priceCents: 100,
    }),
  ];

  it("is deterministic for a fixed seed and improves the deck score", () => {
    const deck = makeCommanderDeck();
    const r1 = optimizeDeck(deck, candidates, {
      format: "commander",
      targetBracket: 3,
      maxSwaps: 3,
      iterations: 200,
      rng: seededRng("opt-seed-1"),
    });
    const r2 = optimizeDeck(deck, candidates, {
      format: "commander",
      targetBracket: 3,
      maxSwaps: 3,
      iterations: 200,
      rng: seededRng("opt-seed-1"),
    });

    expect(r1).toEqual(r2);
    expect(r1.after.total).toBeGreaterThan(r1.before.total);
    expect(r1.swaps.length).toBeGreaterThan(0);
    expect(r1.swaps.length).toBeLessThanOrEqual(3);
    for (const s of r1.swaps) {
      expect(s.cut.oracleId.startsWith("filler-")).toBe(true);
    }
  });

  it("respects lockedOracleIds and maxAddedPriceCents", () => {
    const deck = makeCommanderDeck();
    const locked = new Set(
      deck.filter((c) => c.oracleId.startsWith("filler-")).map((c) => c.oracleId),
    );
    const resLocked = optimizeDeck(deck, candidates, {
      format: "commander",
      maxSwaps: 3,
      iterations: 100,
      lockedOracleIds: locked,
      rng: seededRng("locked-test"),
    });
    for (const s of resLocked.swaps) {
      expect(locked.has(s.cut.oracleId)).toBe(false);
    }

    const resBudget = optimizeDeck(deck, candidates, {
      format: "commander",
      maxSwaps: 3,
      iterations: 250,
      maxAddedPriceCents: 500,
      rng: seededRng("budget-test"),
    });
    expect(resBudget.after.metrics.addedPriceCents).toBeLessThanOrEqual(500);
    expect(resBudget.swaps.some((s) => s.add.oracleId === "add-draw-2")).toBe(false);
  });
});
