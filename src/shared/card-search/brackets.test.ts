import { describe, expect, it } from "vitest";
import { BRACKET_FLAGS, bracketFlags, type BracketFacts, type BracketFlag } from "./brackets";

// Real Oracle text, quoted (design doc 31, invariant 5): matches and near-misses for each rule.
type Example = Readonly<{ name: string } & BracketFacts>;

const card = (name: string, typeLine: string, text: string, isGameChanger = false) =>
  ({ name, typeLine, text, isGameChanger }) satisfies Example;

const EXAMPLES: ReadonlyArray<readonly [Example, readonly BracketFlag[]]> = [
  // Land denial
  [card("Armageddon", "Sorcery", "Destroy all lands."), ["landDenial"]],
  [card("Ravages of War", "Sorcery", "Destroy all lands."), ["landDenial"]],
  [
    card(
      "Jokulhaups",
      "Sorcery",
      "Destroy all artifacts, creatures, and lands. They can't be regenerated.",
    ),
    ["landDenial"],
  ],
  [card("Ruination", "Sorcery", "Destroy all nonbasic lands."), ["landDenial"]],
  [card("Sunder", "Instant", "Return all lands to their owners' hands."), ["landDenial"]],
  [
    card(
      "Wildfire",
      "Sorcery",
      "Each player sacrifices four lands. Wildfire deals 4 damage to each creature.",
    ),
    ["landDenial"],
  ],
  [
    card(
      "Global Ruin",
      "Sorcery",
      "Each player chooses from the lands they control a land of each basic land type, then sacrifices the rest.",
    ),
    ["landDenial"],
  ],
  [
    card(
      "Winter Orb",
      "Artifact",
      "As long as Winter Orb is untapped, players can't untap more than one land during their untap steps.",
    ),
    ["landDenial"],
  ],
  [
    card(
      "Stasis",
      "Enchantment",
      "Players skip their untap steps.\nAt the beginning of your upkeep, sacrifice Stasis unless you pay {U}.",
    ),
    ["landDenial"],
  ],
  [
    card(
      "Back to Basics",
      "Enchantment",
      "Nonbasic lands don't untap during their controllers' untap steps.",
    ),
    ["landDenial"],
  ],
  [card("Blood Moon", "Enchantment", "Nonbasic lands are Mountains."), ["landDenial"]],
  [
    card("Magus of the Moon", "Creature — Human Wizard", "Nonbasic lands are Mountains."),
    ["landDenial"],
  ],
  // Near-misses: one land, your own lands, other permanents.
  [
    card("Strip Mine", "Land", "{T}: Add {C}.\n{T}, Sacrifice Strip Mine: Destroy target land."),
    [],
  ],
  [card("Wrath of God", "Sorcery", "Destroy all creatures. They can't be regenerated."), []],
  [
    card(
      "Mana Vault",
      "Artifact",
      "Mana Vault doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {4}. If you do, untap Mana Vault.\nAt the beginning of your draw step, if Mana Vault is tapped, it deals 1 damage to you.\n{T}: Add {C}{C}{C}.",
      true,
    ),
    ["gameChanger"],
  ],
  [card("Zuran Orb", "Artifact", "Sacrifice a land: You gain 2 life."), []],
  [
    card(
      "Fleshbag Marauder",
      "Creature — Zombie Warrior",
      "When Fleshbag Marauder enters, each player sacrifices a creature.",
    ),
    [],
  ],

  // Extra turns
  [
    card("Time Warp", "Sorcery", "Target player takes an extra turn after this one."),
    ["extraTurn"],
  ],
  [
    card(
      "Nexus of Fate",
      "Instant",
      "Take an extra turn after this one.\nIf Nexus of Fate would be put into a graveyard from anywhere, reveal Nexus of Fate and shuffle it into its owner's library instead.",
    ),
    ["extraTurn"],
  ],
  [
    card("Time Stretch", "Sorcery", "Target player takes two extra turns after this one."),
    ["extraTurn"],
  ],
  // Near-misses: extra combats, and cards that stop extra turns.
  [
    card(
      "Relentless Assault",
      "Sorcery",
      "Untap all creatures that attacked this turn. After this main phase, there is an additional combat phase followed by an additional main phase.",
    ),
    [],
  ],
  [
    card(
      "Stranglehold",
      "Enchantment",
      "Your opponents can't search libraries.\nIf an opponent would begin an extra turn, that player skips that turn instead.",
    ),
    [],
  ],

  // Game Changers come only from Scryfall's flag (invariant 7), never from text.
  [
    card(
      "Rhystic Study",
      "Enchantment",
      "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
      true,
    ),
    ["gameChanger"],
  ],
  [
    card(
      "Rhystic Study (unflagged)",
      "Enchantment",
      "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
    ),
    [],
  ],
];

describe("bracketFlags", () => {
  it.each(EXAMPLES)("$name", (example, expected) => {
    expect(bracketFlags(example)).toEqual(expected);
  });

  it("has a match and a near-miss for every flag", () => {
    for (const flag of BRACKET_FLAGS) {
      expect(EXAMPLES.some(([, flags]) => flags.includes(flag))).toBe(true);
    }
    expect(EXAMPLES.filter(([, flags]) => flags.length === 0).length).toBeGreaterThan(5);
  });

  it("ignores reminder text", () => {
    expect(
      bracketFlags(card("Example", "Creature", "Flash (Take an extra turn — not really.)")),
    ).toEqual([]);
  });

  it("gives a card several flags, in order", () => {
    expect(
      bracketFlags(
        card("Both", "Sorcery", "Destroy all lands. Take an extra turn after this one.", true),
      ),
    ).toEqual(["gameChanger", "landDenial", "extraTurn"]);
  });
});
