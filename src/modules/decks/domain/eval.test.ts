import type { Tag } from "@/shared/card-search";
import { describe, expect, it } from "vitest";
import { evaluateHoldout, type EvalDeckLine } from "./eval";
import type { CandidateCard } from "./suggest";

function makeLine(
  oracleId: string,
  name: string,
  opts: Partial<EvalDeckLine> & {
    text?: string;
    edhrecSynergy?: number;
    edhrecRank?: number;
    rarity?: string;
    roles?: readonly Tag[];
  } = {},
): EvalDeckLine {
  const typeLine = opts.typeLine ?? "Creature — Goblin";
  const manaValue = opts.manaValue ?? 3;
  const text = opts.text ?? "";
  const rarity = opts.rarity ?? "rare";
  const candidate: CandidateCard = {
    oracleId,
    name,
    typeLine,
    manaValue,
    text,
    keywords: opts.keywords ?? [],
    roles: opts.roles ?? [],
    themes: [],
    rarity,
    priceCents: opts.priceCents ?? 200,
    pool: "store",
    edhrecRank: opts.edhrecRank ?? 500,
    edhrec:
      opts.edhrecSynergy !== undefined
        ? { inclusionRate: 0.45, synergy: opts.edhrecSynergy, totalDecks: 800 }
        : undefined,
  };
  return {
    oracleId,
    name,
    board: opts.board ?? "main",
    quantity: 1,
    typeLine,
    manaValue,
    text,
    keywords: opts.keywords ?? [],
    priceCents: opts.priceCents ?? 200,
    candidate,
  };
}

describe("evaluateHoldout (#57)", () => {
  it("achieves high Recall@50 on a sacrifice/Treasure Commander decklist against distractors", () => {
    const deck: EvalDeckLine[] = [
      makeLine("cmd", "Korvold, Fae-Cursed King", {
        board: "commander",
        typeLine: "Legendary Creature — Dragon Noble",
        manaValue: 5,
        text: "Whenever Korvold enters or attacks, sacrifice another permanent. Whenever you sacrifice a permanent, draw a card.",
      }),
      makeLine("c1", "Mayhem Devil", {
        text: "Whenever a player sacrifices a permanent, deal 1 damage.",
        edhrecSynergy: 0.42,
      }),
      makeLine("c2", "Pitiless Plunderer", {
        text: "Whenever another creature you control dies, create a Treasure token.",
        edhrecSynergy: 0.38,
      }),
      makeLine("c3", "Dockside Extortionist", {
        text: "When ~ enters, create X Treasure tokens.",
        edhrecSynergy: 0.35,
        roles: ["ramp"],
      }),
      makeLine("c4", "Viscera Seer", {
        manaValue: 1,
        text: "Sacrifice a creature: Scry 1.",
        edhrecSynergy: 0.28,
      }),
      makeLine("c5", "Woe Strider", {
        text: "Sacrifice another creature: Scry 1.",
        edhrecSynergy: 0.25,
      }),
      makeLine("c6", "Deadly Dispute", {
        typeLine: "Instant",
        manaValue: 2,
        text: "As an additional cost, sacrifice an artifact or creature. Draw two cards and create a Treasure token.",
        edhrecSynergy: 0.31,
      }),
      makeLine("c7", "Professional Face-Breaker", {
        text: "Whenever creatures deal combat damage, create a Treasure token.",
        edhrecSynergy: 0.29,
      }),
      makeLine("c8", "Tireless Provisioner", {
        text: "Landfall — Whenever a land enters, create a Treasure token.",
        edhrecSynergy: 0.27,
      }),
      makeLine("c9", "Ziatora, the Incinerator", {
        manaValue: 6,
        text: "Sacrifice another creature: deal damage and create three Treasure tokens.",
        edhrecSynergy: 0.33,
      }),
      makeLine("c10", "Goblin Bombardment", {
        typeLine: "Enchantment",
        manaValue: 2,
        text: "Sacrifice a creature: Goblin Bombardment deals 1 damage to any target.",
        edhrecSynergy: 0.36,
      }),
      makeLine("c11", "Zulaport Cutthroat", {
        manaValue: 2,
        text: "Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life.",
        edhrecSynergy: 0.3,
      }),
      makeLine("c12", "Bastion of Remembrance", {
        typeLine: "Enchantment",
        manaValue: 3,
        text: "Whenever a creature you control dies, each opponent loses 1 life.",
        edhrecSynergy: 0.26,
      }),
      makeLine("c13", "Squee, the Immortal", {
        text: "You may cast Squee from your graveyard or from exile.",
        edhrecSynergy: 0.2,
      }),
      makeLine("c14", "Phyrexian Altar", {
        typeLine: "Artifact",
        manaValue: 3,
        text: "Sacrifice a creature: Add one mana of any color.",
        edhrecSynergy: 0.31,
      }),
    ];

    const distractors: CandidateCard[] = Array.from({ length: 60 }, (_, i) => ({
      oracleId: `dist-${i}`,
      name: `Vanilla Chaff ${i}`,
      typeLine: "Creature — Beast",
      manaValue: 4,
      text: "Trample",
      keywords: ["Trample"],
      roles: [],
      themes: [],
      rarity: "common",
      priceCents: 10,
      pool: "store",
      edhrecRank: 18000,
    }));

    const result = evaluateHoldout(deck, distractors, { holdoutCount: 10, k: 50 });
    expect(result.tier).toBe("upgraded");
    expect(result.holdoutCount).toBe(10);
    expect(result.recallAtK).toBeGreaterThanOrEqual(0.9);
    expect(result.mrr).toBeGreaterThan(0.2);

    const casual = evaluateHoldout(deck, distractors, {
      holdoutCount: 10,
      k: 50,
      targetBracket: 2,
    });
    expect(casual.tier).toBe("casual");
    const optimized = evaluateHoldout(deck, distractors, {
      holdoutCount: 10,
      k: 50,
      targetBracket: 4,
    });
    expect(optimized.tier).toBe("optimized");
  });
});
