import { describe, expect, it } from "vitest";
import {
  cardSignalIO,
  deckSignalProfile,
  SIGNAL_LABELS,
  synergyMatches,
  type SignalLine,
} from "./signals";

describe("cardSignalIO", () => {
  it("tags Treasure makers as making treasure + artifact_synergy", () => {
    const io = cardSignalIO({
      name: "Smothering Tithe",
      typeLine: "Enchantment",
      manaValue: 4,
      text: "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.",
    });
    expect(io.makes).toContain("treasure");
    expect(io.makes).toContain("artifact_synergy");
    expect(io.makes).toContain("enchantment_synergy");
  });

  it("tags artifact sacrifice payoffs as using treasure and sacrifice", () => {
    const io = cardSignalIO({
      name: "Mayhem Devil",
      typeLine: "Creature — Devil",
      manaValue: 3,
      text: "Whenever a player sacrifices a permanent, Mayhem Devil deals 1 damage to any target.",
    });
    expect(io.uses).toContain("sacrifice");
    expect(io.uses).toContain("treasure");
  });

  it("ignores reminder text when extracting signals", () => {
    const io = cardSignalIO({
      name: "Reminder Only",
      typeLine: "Creature — Soldier",
      manaValue: 2,
      text: "Vigilance (Attacking doesn't cause this creature to tap.)\nAmass Orcs 1 (Put a +1/+1 counter on an Army you control.)",
    });
    expect(io.makes).not.toContain("plus_one_counter");
  });

  it("tags cheap instants/sorceries as making spellslinger and payoffs as using it", () => {
    const bolt = cardSignalIO({
      name: "Lightning Bolt",
      typeLine: "Instant",
      manaValue: 1,
      text: "Lightning Bolt deals 3 damage to any target.",
    });
    const gutternsnipe = cardSignalIO({
      name: "Guttersnipe",
      typeLine: "Creature — Goblin Shaman",
      manaValue: 3,
      text: "Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.",
    });
    expect(bolt.makes).toContain("spellslinger");
    expect(gutternsnipe.uses).toContain("spellslinger");
  });
});

describe("deckSignalProfile & synergyMatches", () => {
  const deck: SignalLine[] = [
    {
      name: "Korvold, Fae-Cursed King",
      typeLine: "Legendary Creature — Dragon Noble",
      manaValue: 5,
      text: "Flying\nWhenever Korvold, Fae-Cursed King enters or attacks, sacrifice another permanent.\nWhenever you sacrifice a permanent, put a +1/+1 counter on Korvold and draw a card.",
      board: "commander",
      quantity: 1,
    },
    {
      name: "Pitiless Plunderer",
      typeLine: "Creature — Human Pirate",
      manaValue: 4,
      text: "Whenever another creature you control dies, create a Treasure token.",
      board: "main",
      quantity: 1,
    },
  ];

  it("weights commander signals 3x compared to main-deck cards", () => {
    const profile = deckSignalProfile(deck);
    // Korvold uses sacrifice (3) + makes sacrifice (3); Pitiless Plunderer uses sacrifice (1) + makes treasure (1)
    expect(profile.uses.get("sacrifice")).toBe(4);
    expect(profile.makes.get("treasure")).toBe(1);
  });

  it("matches a Treasure maker to a sacrifice-using deck with sqrt dampening", () => {
    const profile = deckSignalProfile(deck);
    const dockside = cardSignalIO({
      name: "Professional Face-Breaker",
      typeLine: "Creature — Human Warrior",
      manaValue: 3,
      text: "Menace\nWhenever one or more creatures you control deal combat damage to a player, create a Treasure token.\nSacrifice a Treasure: Exile the top card of your library.",
    });
    const result = synergyMatches(dockside, profile);
    expect(result.total).toBeGreaterThan(0);
    expect(result.matches.some((m) => m.tag === "treasure")).toBe(true);
    expect(SIGNAL_LABELS.treasure).toBeTruthy();
  });

  it("dampens repeated deck counts sublinearly", () => {
    const small: SignalLine[] = [
      {
        name: "Mayhem Devil",
        typeLine: "Creature",
        manaValue: 3,
        text: "Whenever you sacrifice a permanent, deal 1 damage.",
        board: "main",
        quantity: 1,
      },
    ];
    const large: SignalLine[] = Array.from({ length: 9 }, (_, i) => ({
      name: `Payoff ${i}`,
      typeLine: "Creature",
      manaValue: 3,
      text: "Whenever you sacrifice a permanent, deal 1 damage.",
      board: "main",
      quantity: 1,
    }));
    const sacOutlet = cardSignalIO({
      name: "Viscera Seer",
      typeLine: "Creature",
      manaValue: 1,
      text: "Sacrifice a creature: Scry 1.",
    });
    const r1 = synergyMatches(sacOutlet, deckSignalProfile(small));
    const r9 = synergyMatches(sacOutlet, deckSignalProfile(large));
    // 9x deck cards -> sqrt(9)/sqrt(1) = 3x, not 9x
    expect(r9.total).toBeCloseTo(r1.total * 3, 5);
  });
});
