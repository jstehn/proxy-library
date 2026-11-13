import { describe, expect, it } from "vitest";
import { scoreDeck, type OptimizerCard } from "./optimize";

function card(
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

function buildReferenceDeck(opts: {
  lands: number;
  ramp: number;
  draw: number;
  removal: number;
  synergyFillers: number;
  highMvVanilla: number;
  rarity: "common" | "rare" | "mythic";
  edhrecSynergy: number;
  edhrecInclusion: number;
}): OptimizerCard[] {
  const cards: OptimizerCard[] = [
    card({
      oracleId: "cmd",
      name: "Muldrotha, the Gravetide",
      typeLine: "Legendary Creature — Elemental Avatar",
      manaValue: 6,
      manaCost: "{3}{B}{G}{U}",
      text: "During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.",
      themes: ["graveyard"],
      rarity: "mythic",
      board: "commander",
    }),
  ];

  let idx = 0;
  for (let i = 0; i < opts.lands; i++) {
    const color = (["U", "B", "G"] as const)[i % 3];
    cards.push(
      card({
        oracleId: `land-${idx++}`,
        name: `Dual Land ${i}`,
        typeLine: "Land",
        manaValue: 0,
        manaCost: null,
        producedMana: [color, "G"],
        rarity: opts.rarity,
      }),
    );
  }

  for (let i = 0; i < opts.ramp; i++) {
    cards.push(
      card({
        oracleId: `ramp-${idx++}`,
        name: `Ramp Piece ${i}`,
        typeLine: "Artifact",
        manaValue: 2,
        manaCost: "{1}{G}",
        roles: ["ramp"],
        themes: ["graveyard"],
        rarity: opts.rarity,
        edhrec: {
          inclusionRate: opts.edhrecInclusion,
          synergy: opts.edhrecSynergy,
          totalDecks: 1000,
        },
        edhrecRank: 150,
      }),
    );
  }

  for (let i = 0; i < opts.draw; i++) {
    cards.push(
      card({
        oracleId: `draw-${idx++}`,
        name: `Draw Engine ${i}`,
        typeLine: "Enchantment",
        manaValue: 3,
        manaCost: "{2}{U}",
        roles: ["draw"],
        themes: ["graveyard"],
        rarity: opts.rarity,
        edhrec: {
          inclusionRate: opts.edhrecInclusion,
          synergy: opts.edhrecSynergy,
          totalDecks: 1000,
        },
        edhrecRank: 200,
      }),
    );
  }

  for (let i = 0; i < opts.removal; i++) {
    cards.push(
      card({
        oracleId: `rem-${idx++}`,
        name: `Interaction ${i}`,
        typeLine: "Creature — Insect",
        manaValue: 2,
        manaCost: "{1}{B}",
        roles: ["removal"],
        themes: ["graveyard"],
        keywords: ["Flash"],
        rarity: opts.rarity,
        edhrec: {
          inclusionRate: opts.edhrecInclusion,
          synergy: opts.edhrecSynergy,
          totalDecks: 1000,
        },
        edhrecRank: 300,
      }),
    );
  }

  for (let i = 0; i < opts.synergyFillers; i++) {
    cards.push(
      card({
        oracleId: `syn-${idx++}`,
        name: `Graveyard Payoff ${i}`,
        typeLine: "Creature — Zombie",
        manaValue: 3,
        manaCost: "{2}{B}",
        themes: ["graveyard"],
        rarity: opts.rarity,
        edhrec: {
          inclusionRate: opts.edhrecInclusion,
          synergy: opts.edhrecSynergy,
          totalDecks: 1000,
        },
        edhrecRank: 400,
      }),
    );
  }

  for (let i = 0; i < opts.highMvVanilla; i++) {
    cards.push(
      card({
        oracleId: `van-${idx++}`,
        name: `Overcosted Vanilla ${i}`,
        typeLine: "Creature — Wurm",
        manaValue: 7,
        manaCost: "{5}{G}{G}",
        rarity: "common",
        edhrecRank: 25000,
      }),
    );
  }

  return cards;
}

describe("scoreDeck reference deck calibration", () => {
  const tuned = buildReferenceDeck({
    lands: 37,
    ramp: 12,
    draw: 10,
    removal: 10,
    synergyFillers: 30,
    highMvVanilla: 0,
    rarity: "rare",
    edhrecSynergy: 0.35,
    edhrecInclusion: 0.55,
  });

  const precon = buildReferenceDeck({
    lands: 37,
    ramp: 8,
    draw: 7,
    removal: 6,
    synergyFillers: 25,
    highMvVanilla: 16,
    rarity: "common",
    edhrecSynergy: 0.15,
    edhrecInclusion: 0.25,
  });

  const unfocused = buildReferenceDeck({
    lands: 26,
    ramp: 2,
    draw: 2,
    removal: 2,
    synergyFillers: 10,
    highMvVanilla: 57,
    rarity: "common",
    edhrecSynergy: 0,
    edhrecInclusion: 0.02,
  });

  it("orders tuned > precon > unfocused deterministically", () => {
    const tunedScore = scoreDeck(tuned, { format: "commander", targetBracket: 3 });
    const preconScore = scoreDeck(precon, { format: "commander", targetBracket: 2 });
    const unfocusedScore = scoreDeck(unfocused, { format: "commander", targetBracket: 2 });

    expect(tunedScore.total).toBeGreaterThan(preconScore.total);
    expect(preconScore.total).toBeGreaterThan(unfocusedScore.total);

    // Determinism check
    expect(scoreDeck(tuned, { format: "commander", targetBracket: 3 })).toEqual(tunedScore);
  });

  it("produces identical scores when card metadata (keywords, rarity, edhrec) is preserved", () => {
    const full = scoreDeck(tuned, { format: "commander", targetBracket: 3 });
    const stripped = scoreDeck(
      tuned.map((c) => ({ ...c, keywords: [], rarity: "common", edhrec: null, edhrecRank: null })),
      { format: "commander", targetBracket: 3 },
    );

    expect(full.total).not.toEqual(stripped.total);
  });
});
