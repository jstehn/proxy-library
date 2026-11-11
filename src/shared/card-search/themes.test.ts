import { describe, expect, it } from "vitest";
import { cardThemes, leaderThemes, THEME_LABELS, THEMES, type Theme } from "./tags";

// Themes (design docs 20 and 38), with quoted Oracle text: what a commander leads, and what a
// card fits, including the token and politics umbrella/sub-theme hierarchies.
const card = (typeLine: string, text: string) => ({ typeLine, text });

describe("leaderThemes: what a commander builds around", () => {
  const leaders: ReadonlyArray<readonly [string, ReturnType<typeof card>, readonly Theme[]]> = [
    [
      "Atraxa, Praetors' Voice",
      card(
        "Legendary Creature — Phyrexian Angel Horror",
        "Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)",
      ),
      ["counters"],
    ],
    [
      "Korvold, Fae-Cursed King",
      card(
        "Legendary Creature — Dragon Noble",
        "Flying\nWhenever Korvold enters or attacks, sacrifice another permanent.\nWhenever you sacrifice a permanent, put a +1/+1 counter on Korvold and draw a card.",
      ),
      ["counters", "sacrifice"],
    ],
    [
      "Rhys the Redeemed",
      card(
        "Legendary Creature — Elf Warrior",
        "{2}{G/W}, {T}: Create a 1/1 green and white Elf Warrior creature token.\n{4}{G/W}{G/W}, {T}: For each creature token you control, create a token that's a copy of that creature.",
      ),
      ["tokens", "creature-tokens"],
    ],
    [
      "Jolene, the Plunder Queen",
      card(
        "Legendary Creature — Human Warrior",
        "Whenever a player attacks one of your opponents, that attacking player creates a Treasure token.\nIf you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.\nSacrifice five Treasures: Put five +1/+1 counters on Jolene.",
      ),
      ["counters", "tokens", "artifact-tokens", "treasures"],
    ],
    [
      "Samwise Gamgee",
      card(
        "Legendary Creature — Halfling Peasant",
        "Whenever another nontoken creature you control enters, create a Food token.\nSacrifice three Foods: Return target Historic card from your graveyard to your hand.",
      ),
      ["tokens", "artifact-tokens", "food", "graveyard", "legends"],
    ],
    [
      "Lonis, Cryptozoologist",
      card(
        "Legendary Creature — Snake Elf Scout",
        "Whenever another nontoken creature you control enters, investigate.\n{T}, Sacrifice X Clues: Target opponent reveals the top X cards of their library. You may put a nonland permanent card with mana value X or less from among them onto the battlefield under your control.",
      ),
      ["tokens", "artifact-tokens", "clues"],
    ],
    [
      "Karlov of the Ghost Council",
      card(
        "Legendary Creature — Spirit Advisor",
        "Whenever you gain life, put two +1/+1 counters on Karlov of the Ghost Council.\n{W}{B}, Remove six +1/+1 counters from Karlov: Exile target creature.",
      ),
      ["counters", "lifegain"],
    ],
    [
      "Sythis, Harvest's Hand",
      card(
        "Legendary Enchantment Creature — Nymph",
        "Whenever you cast an enchantment spell, you gain 1 life and draw a card.",
      ),
      ["enchantments"],
    ],
    [
      "Veyran, Voice of Duality",
      card(
        "Legendary Creature — Efreet Wizard",
        "Magecraft — Whenever you cast or copy an instant or sorcery spell, Veyran gets +1/+1 until end of turn.",
      ),
      ["spells", "clones"],
    ],
    [
      "Tatyova, Benthic Druid",
      card(
        "Legendary Creature — Merfolk Druid",
        "Landfall — Whenever a land you control enters, you gain 1 life and draw a card.",
      ),
      ["landfall"],
    ],
    [
      "Sram, Senior Edificer",
      card(
        "Legendary Creature — Dwarf Advisor",
        "Whenever you cast an Aura, Equipment, or Vehicle spell, draw a card.",
      ),
      ["equipment", "vehicles"],
    ],
    [
      "Muldrotha, the Gravetide",
      card(
        "Legendary Creature — Elemental Avatar",
        "During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.",
      ),
      ["graveyard"],
    ],
    [
      "Urza, Lord High Artificer",
      card(
        "Legendary Creature — Human Artificer",
        'When Urza enters, create a 0/0 colorless Construct artifact creature token with "This creature gets +1/+1 for each artifact you control."\nTap an untapped artifact you control: Add {U}.',
      ),
      ["tokens", "creature-tokens", "artifact-tokens", "artifacts"],
    ],
    [
      "Marisi, Breaker of the Coil",
      card(
        "Legendary Creature — Cat Warrior",
        "Your opponents can't cast spells during combat.\nWhenever a creature you control deals combat damage to a player, goad each creature that player controls.",
      ),
      ["politics", "goad"],
    ],
    [
      "Tivit, Seller of Secrets",
      card(
        "Legendary Creature — Sphinx Rogue",
        "Council's dilemma — Whenever Tivit enters or deals combat damage to a player, starting with you, each player votes for evidence or bribery. For each evidence vote, investigate. For each bribery vote, create a Treasure token.",
      ),
      ["tokens", "artifact-tokens", "treasures", "clues", "politics", "voting"],
    ],
    [
      "Kynaios and Tiro of Meletis",
      card(
        "Legendary Creature — Human Soldier",
        "At the beginning of your end step, draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.",
      ),
      ["politics", "group-hug", "each-opponent"],
    ],
    [
      "Queen Marchesa",
      card(
        "Legendary Creature — Human Assassin",
        "When Queen Marchesa enters, you become the monarch.\nAt the beginning of your upkeep, if an opponent is the monarch, create a 1/1 black Assassin creature token with deathtouch and haste.",
      ),
      ["tokens", "creature-tokens", "politics", "monarch"],
    ],
    [
      "Brago, King Eternal",
      card(
        "Legendary Creature — Spirit Noble",
        "Whenever Brago deals combat damage to a player, exile any number of target nonland permanents you control, then return those cards to the battlefield under their owner's control.",
      ),
      ["blink"],
    ],
    [
      "The Locust God",
      card(
        "Legendary Creature — God",
        "Whenever you draw a card, create a 1/1 blue and red Insect creature token with flying and haste.\n{2}{U}{R}: Draw a card, then discard a card.",
      ),
      ["tokens", "creature-tokens", "wheels"],
    ],
    [
      "Gonti, Lord of Luxury",
      card(
        "Legendary Creature — Aetherborn Rogue",
        "When Gonti enters, look at the top four cards of target opponent's library, exile one of them face down, then put the rest on the bottom of that library in a random order. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.",
      ),
      ["theft"],
    ],
    [
      "Carth the Lion",
      card(
        "Legendary Creature — Human Warrior",
        "Planeswalkers you control have '+1: Look at the top X cards of your library.'\nLoyalty abilities of planeswalkers you control cost an additional [+1] to activate.",
      ),
      ["planeswalkers"],
    ],
    [
      "Prosper, Tome-Bound",
      card(
        "Legendary Creature — Tiefling Warlock",
        "Deathtouch\nMystic Arcanum — At the beginning of your end step, exile the top card of your library. Until the end of your next turn, you may play that card.\nPact Boon — Whenever you play a card from exile, create a Treasure token.",
      ),
      ["tokens", "artifact-tokens", "treasures", "exile"],
    ],
    [
      "Aurelia, the Warleader",
      card(
        "Legendary Creature — Angel",
        "Flying, vigilance, haste\nWhenever Aurelia, the Warleader attacks for the first time each turn, untap all creatures you control. After this phase, there is an additional combat phase.",
      ),
      ["extra-combat"],
    ],
    [
      "Grand Arbiter Augustin IV",
      card(
        "Legendary Creature — Human Advisor",
        "White spells you cast cost {1} less to cast.\nBlue spells you cast cost {1} less to cast.\nSpells your opponents cast cost {1} more to cast.",
      ),
      ["stax"],
    ],
    [
      "Fynn, the Fangbearer",
      card(
        "Legendary Creature — Human Warrior",
        "Deathtouch\nWhenever a creature you control with deathtouch deals combat damage to a player, that player gets two poison counters.",
      ),
      ["poison"],
    ],
    [
      "Ezuri, Renegade Leader",
      card(
        "Legendary Creature — Elf Warrior",
        "{G}: Regenerate another target Elf.\n{2}{G}{G}{G}: Elf creatures you control get +3/+3 and gain trample until end of turn.",
      ),
      [], // a tribe, not a theme: tribes are worked out from creature types (suggest.ts)
    ],
  ];

  it.each(leaders)("%s", (_name, leader, themes) => {
    expect(leaderThemes(leader)).toEqual(themes);
  });

  it("leads every theme somewhere in the examples", () => {
    const led = new Set(leaders.flatMap(([, , themes]) => themes));
    expect(THEMES.filter((theme) => !led.has(theme))).toEqual([]);
  });
});

describe("cardThemes: what a card plays into", () => {
  it.each([
    [
      "Viscera Seer",
      card("Creature — Vampire Wizard", "Sacrifice a creature: Scry 1."),
      ["sacrifice"],
    ],
    ["Sol Ring", card("Artifact", "{T}: Add {C}{C}."), ["artifacts"]],
    [
      "Swords to Plowshares",
      card("Instant", "Exile target creature. Its controller gains life equal to its power."),
      ["spells"],
    ],
    [
      "Hardened Scales",
      card(
        "Enchantment",
        "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.",
      ),
      ["counters", "enchantments"],
    ],
    [
      "Swiftfoot Boots",
      card("Artifact — Equipment", "Equipped creature has hexproof and haste.\nEquip {1}"),
      ["artifacts", "equipment"],
    ],
    [
      "Ajani's Pridemate",
      card(
        "Creature — Cat Soldier",
        "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
      ),
      ["counters", "lifegain"],
    ],
    [
      "Exploration",
      card("Enchantment", "You may play an additional land on each of your turns."),
      ["enchantments", "landfall"],
    ],
    [
      "Smothering Tithe",
      card(
        "Enchantment",
        "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.",
      ),
      ["tokens", "artifact-tokens", "treasures", "enchantments"],
    ],
    [
      "Ghostly Prison",
      card(
        "Enchantment",
        "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
      ),
      ["enchantments", "politics"],
    ],
    [
      "Ephemerate",
      card(
        "Instant",
        "Exile target creature you control, then return it to the battlefield under its owner's control.\nRebound",
      ),
      ["spells", "blink"],
    ],
    [
      "Mox Amber",
      card(
        "Legendary Artifact",
        "{T}: Add one mana of any color among legendary creatures and planeswalkers you control.",
      ),
      ["artifacts", "planeswalkers", "legends"],
    ],
    [
      "Light Up the Stage",
      card(
        "Sorcery",
        "Spectacle {R}\nExile the top two cards of your library. Until the end of your next turn, you may play those cards.",
      ),
      ["spells", "exile"],
    ],
    [
      "Relentless Assault",
      card(
        "Sorcery",
        "Untap all creatures that attacked this turn. After this main phase, there is an additional combat phase followed by an additional main phase.",
      ),
      ["spells", "extra-combat"],
    ],
    [
      "Rule of Law",
      card("Enchantment", "Each player can't cast more than one spell each turn."),
      ["enchantments", "stax"],
    ],
    [
      "Blighted Agent",
      card(
        "Creature — Phyrexian Human Rogue",
        "Infect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\nBlighted Agent can't be blocked.",
      ),
      ["poison"],
    ],
    [
      "Smuggler's Copter",
      card(
        "Artifact — Vehicle",
        "Flying\nWhenever Smuggler's Copter attacks or blocks, you may draw a card. If you do, discard a card.\nCrew 1",
      ),
      ["artifacts", "wheels", "vehicles"],
    ],
    [
      "Jace, the Mind Sculptor",
      card("Legendary Planeswalker — Jace", "+2: Look at the top card of target player's library."),
      ["planeswalkers"],
    ],
    ["Grizzly Bears", card("Creature — Bear", ""), []],
    // Lifelink itself counts: the creature gains you life.
    [
      "Vampire Nighthawk",
      card("Creature — Vampire Shaman", "Flying, deathtouch, lifelink"),
      ["lifegain"],
    ],
  ] as const)("%s", (_name, example, themes) => {
    expect(cardThemes(example)).toEqual(themes);
  });

  it("names every theme", () => {
    for (const theme of THEMES) expect(THEME_LABELS[theme]).toMatch(/\w/);
  });
});
