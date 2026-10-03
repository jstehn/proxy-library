import { describe, expect, it } from "vitest";
import { cardTags, TAGS, type Tag, type TagFacts } from "./tags";

// Real Oracle text, quoted: the fixture catalog has too few staples (design doc 19, invariant 3).
type Example = Readonly<{ name: string } & TagFacts>;

const card = (name: string, typeLine: string, text: string, producedMana: string[] = []) =>
  ({ name, typeLine, text, producedMana }) satisfies Example;

const EXAMPLES: ReadonlyArray<readonly [Example, readonly Tag[]]> = [
  // Ramp
  [card("Sol Ring", "Artifact", "{T}: Add {C}{C}.", ["C"]), ["ramp"]],
  [card("Llanowar Elves", "Creature — Elf Druid", "{T}: Add {G}.", ["G"]), ["ramp"]],
  [
    card(
      "Cultivate",
      "Sorcery",
      "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
    ),
    ["ramp"],
  ],
  [
    card(
      "Nature's Lore",
      "Sorcery",
      "Search your library for a Forest card, put that card onto the battlefield, then shuffle.",
    ),
    ["ramp"],
  ],
  [
    card("Exploration", "Enchantment", "You may play an additional land on each of your turns."),
    ["ramp"],
  ],
  [
    card(
      "Smothering Tithe",
      "Enchantment",
      "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.",
    ),
    ["ramp"],
  ],
  // Lands aren't ramp, even ones that fetch.
  [
    card(
      "Evolving Wilds",
      "Land",
      "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
    ),
    [],
  ],
  [
    card(
      "Command Tower",
      "Land",
      "{T}: Add one mana of any color in your commander's color identity.",
      ["W", "U"],
    ),
    [],
  ],
  // A land search to hand isn't ramp, and isn't a tutor either.
  [
    card(
      "Wood Elves",
      "Creature — Elf Scout",
      "When Wood Elves enters, search your library for a Forest card, put that card onto the battlefield, then shuffle.",
    ),
    ["ramp"],
  ],
  [
    card(
      "Borrowing Shovel",
      "Sorcery",
      "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.",
    ),
    [],
  ],

  // Draw
  [
    card(
      "Rhystic Study",
      "Enchantment",
      "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
    ),
    ["draw"],
  ],
  [card("Harmonize", "Sorcery", "Draw three cards."), ["draw"]],
  [
    card(
      "Return of the Wildspeaker",
      "Instant",
      "Choose one —\n• Draw cards equal to the greatest power among non-Human creatures you control.\n• Non-Human creatures you control get +3/+3 until end of turn.",
    ),
    ["draw"],
  ],
  [
    card(
      "Laboratory Maniac",
      "Creature — Human Wizard",
      "If you would draw a card while your library has no cards in it, you win the game instead.",
    ),
    [],
  ],
  // Reminder text doesn't count.
  [
    card(
      "Thraben Inspector",
      "Creature — Human Soldier",
      'When Thraben Inspector enters, investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")',
    ),
    [],
  ],

  // Removal
  [
    card(
      "Swords to Plowshares",
      "Instant",
      "Exile target creature. Its controller gains life equal to its power.",
    ),
    ["removal"],
  ],
  [card("Lightning Bolt", "Instant", "Lightning Bolt deals 3 damage to any target."), ["removal"]],
  [card("Murder", "Instant", "Destroy target creature."), ["removal"]],
  [
    card(
      "Banishing Light",
      "Enchantment",
      "When Banishing Light enters, exile target nonland permanent an opponent controls until Banishing Light leaves the battlefield.",
    ),
    ["removal"],
  ],
  [
    card(
      "Beast Within",
      "Instant",
      "Destroy target permanent. Its controller creates a 3/3 green Beast creature token.",
    ),
    ["removal"],
  ],
  [
    card(
      "Pacifism",
      "Enchantment — Aura",
      "Enchant creature\nEnchanted creature can't attack or block.",
    ),
    ["removal"],
  ],
  [
    card(
      "Prey Upon",
      "Sorcery",
      "Target creature you control fights target creature you don't control.",
    ),
    ["removal"],
  ],
  // Near misses: a land, a graveyard card, your own creature.
  [card("Stone Rain", "Sorcery", "Destroy target land."), []],
  [
    card(
      "Scavenging Ooze",
      "Creature — Ooze",
      "{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on Scavenging Ooze and you gain 1 life.",
    ),
    [],
  ],
  [
    card(
      "Cloudshift",
      "Instant",
      "Exile target creature you control, then return that card to the battlefield under your control.",
    ),
    [],
  ],

  // Wipes
  [card("Wrath of God", "Sorcery", "Destroy all creatures. They can't be regenerated."), ["wipe"]],
  [
    card(
      "Toxic Deluge",
      "Sorcery",
      "As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.",
    ),
    ["wipe"],
  ],
  [
    card(
      "Blasphemous Act",
      "Sorcery",
      "This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.",
    ),
    ["wipe"],
  ],
  [
    card(
      "Cyclonic Rift",
      "Instant",
      'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of "target" with "each.")',
    ),
    ["removal"],
  ],
  [card("Evacuation", "Instant", "Return all creatures to their owners' hands."), ["wipe"]],

  // Counters
  [card("Counterspell", "Instant", "Counter target spell."), ["counter"]],
  [card("Negate", "Instant", "Counter target noncreature spell."), ["counter"]],
  [
    card(
      "Stifle",
      "Instant",
      "Counter target activated or triggered ability. (Mana abilities can't be targeted.)",
    ),
    ["counter"],
  ],
  [card("Battlegrowth", "Instant", "Put a +1/+1 counter on target creature."), []],

  // Tutors
  [
    card(
      "Demonic Tutor",
      "Sorcery",
      "Search your library for a card, put that card into your hand, then shuffle.",
    ),
    ["tutor"],
  ],
  [
    card(
      "Enlightened Tutor",
      "Instant",
      "Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top.",
    ),
    ["tutor"],
  ],
  [
    card(
      "Squadron Hawk",
      "Creature — Bird",
      "Flying\nWhen Squadron Hawk enters, you may search your library for up to three cards named Squadron Hawk, reveal them, put them into your hand, then shuffle.",
    ),
    [],
  ],

  // Protection
  [
    card(
      "Heroic Intervention",
      "Instant",
      "Permanents you control gain hexproof and indestructible until end of turn.",
    ),
    ["protection"],
  ],
  [
    card(
      "Swiftfoot Boots",
      "Artifact — Equipment",
      "Equipped creature has hexproof and haste.\nEquip {1}",
    ),
    ["protection"],
  ],
  [
    card(
      "Lightning Greaves",
      "Artifact — Equipment",
      "Equipped creature has haste and shroud.\nEquip {0}",
    ),
    ["protection"],
  ],
  [
    card(
      "Teferi's Protection",
      "Instant",
      "Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out.\nExile Teferi's Protection.",
    ),
    ["protection"],
  ],
  // A creature's own hexproof isn't protection for the deck.
  [card("Slippery Bogle", "Creature — Beast", "Hexproof"), []],

  // Several roles.
  [
    card(
      "Fiery Confluence",
      "Sorcery",
      "Choose three. You may choose the same mode more than once.\n• Fiery Confluence deals 1 damage to each creature.\n• Fiery Confluence deals 2 damage to each opponent.\n• Destroy target artifact.",
    ),
    ["removal", "wipe"],
  ],
  [card("Grizzly Bears", "Creature — Bear", ""), []],
];

describe("cardTags", () => {
  it.each(EXAMPLES.map(([example, tags]) => [example.name, example, tags] as const))(
    "%s",
    (_name, example, tags) => {
      expect(cardTags(example)).toEqual(tags);
    },
  );

  it("has a matching example for every tag (invariant 3)", () => {
    const covered = new Set(EXAMPLES.flatMap(([, tags]) => tags));
    expect([...covered].sort()).toEqual([...TAGS].sort());
  });

  it("lists tags in TAGS order", () => {
    const tags = cardTags(card("Both", "Sorcery", "Destroy target creature. Draw a card."));
    expect(tags).toEqual(["draw", "removal"]);
  });
});
