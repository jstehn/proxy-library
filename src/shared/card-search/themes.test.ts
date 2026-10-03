import { describe, expect, it } from "vitest";
import { cardThemes, leaderThemes, THEME_LABELS, THEMES, type Theme } from "./tags";

// Themes (design doc 20, section 3.1), with quoted Oracle text: what a commander leads, and what
// a card fits.
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
      ["tokens"],
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
      ["equipment"],
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
      ["tokens", "artifacts"],
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

  it("leads every theme somewhere in the examples, or the gap is deliberate", () => {
    const led = new Set(leaders.flatMap(([, , themes]) => themes));
    expect(THEMES.filter((theme) => !led.has(theme))).toEqual(["enchantments", "spells"]);
    expect(
      leaderThemes(
        card("Legendary Creature", "Whenever you cast an instant or sorcery spell, copy it."),
      ),
    ).toEqual(["spells"]);
    expect(
      leaderThemes(
        card("Legendary Creature", "Whenever an enchantment you control enters, draw a card."),
      ),
    ).toEqual(["enchantments"]);
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
