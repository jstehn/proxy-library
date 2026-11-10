// The search language additions of design doc 28 (section 3.6) against real Postgres: land
// cycles, field comparisons, "~" for a card's own name, reminder text, tags and legality. The
// cards are made up for the test, with real cards' rules text, in a set of their own.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchPrintings } from "@/modules/catalog";
import { actor, close, db, loadFixtureCatalog, resetPlayers } from "./harness";

afterAll(close);

const jack = actor("jack");

type TestCard = Readonly<{
  name: string;
  typeLine: string;
  text: string;
  manaCost?: string;
  manaValue?: number;
  power?: string;
  toughness?: string;
  keywords?: string[];
  layout?: string;
  backFace?: Readonly<{ name: string; text: string }>;
  legalities?: Record<string, string>;
  roleTags?: string[];
  themeTags?: string[];
  bracketFlags?: string[];
  isGameChanger?: boolean;
}>;

let number = 0;

async function add(card: TestCard): Promise<void> {
  number++;
  const faces = [
    {
      name: card.name.split(" // ")[0],
      text: card.text,
      power: card.power ?? null,
      toughness: card.toughness ?? null,
      loyalty: null,
      defense: null,
    },
    ...(card.backFace
      ? [{ ...card.backFace, power: null, toughness: null, loyalty: null, defense: null }]
      : []),
  ];
  await db.execute(sql`
    insert into printings (id, set_code, collector_number, name, oracle_id, scryfall_id, rarity,
                           colors, color_identity, mana_cost, mana_value, type_line, layout,
                           finishes, border_color, frame_version, frame_effects, promo_types,
                           is_full_art, variant_label, faces, legalities, keywords, role_tags,
                           theme_tags, bracket_flags, is_game_changer)
    values (${randomUUID()}, 'TST', ${String(number)}, ${card.name}, ${randomUUID()},
            ${randomUUID()}, 'common', '{}', '{}', ${card.manaCost ?? null},
            ${card.manaValue ?? 0}, ${card.typeLine}, ${card.layout ?? "normal"},
            '{nonfoil}', 'black', '2015', '{}', '{}', false, '', ${JSON.stringify(faces)}::jsonb,
            ${JSON.stringify(card.legalities ?? {})}::jsonb,
            ${toArray(card.keywords)}, ${toArray(card.roleTags)}, ${toArray(card.themeTags)},
            ${toArray(card.bracketFlags)}, ${card.isGameChanger ?? false})`);
}

function toArray(values: readonly string[] = []) {
  return sql`${`{${values.map((value) => `"${value}"`).join(",")}}`}::text[]`;
}

/** Names found by a search in the test set, sorted. */
async function find(search: string): Promise<string[]> {
  const result = await searchPrintings(db, {
    userId: jack.userId,
    search: `s:tst (${search})`,
    sort: "name",
    page: 1,
  });
  expect(result.notes).toEqual([]);
  if (result.printingIds.length === 0) return [];
  const rows = await db.execute<{ name: string }>(sql`
    select name from printings where id in (${sql.join(
      result.printingIds.map((id) => sql`${id}`),
      sql`, `,
    )})`);
  return rows.rows.map((row) => row.name).sort();
}

const LANDS: readonly TestCard[] = [
  { name: "Volcanic Island", typeLine: "Land — Island Mountain", text: "({T}: Add {U} or {R}.)" },
  {
    name: "Steam Vents",
    typeLine: "Land — Island Mountain",
    text: "({T}: Add {U} or {R}.)\nAs Steam Vents enters, you may pay 2 life. If you don't, it enters tapped.",
  },
  {
    name: "Scalding Tarn",
    typeLine: "Land",
    text: "{T}, Pay 1 life, Sacrifice Scalding Tarn: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.",
  },
  {
    name: "Sulfur Falls",
    typeLine: "Land",
    text: "This land enters tapped unless you control an Island or a Mountain.\n{T}: Add {U} or {R}.",
  },
  {
    name: "Spirebluff Canal",
    typeLine: "Land",
    text: "This land enters tapped unless you control two or fewer other lands.\n{T}: Add {U} or {R}.",
  },
  {
    name: "Stormcarved Coast",
    typeLine: "Land",
    text: "This land enters tapped unless you control two or more other lands.\n{T}: Add {U} or {R}.",
  },
  {
    name: "Shivan Reef",
    typeLine: "Land",
    text: "{T}: Add {C}.\n{T}: Add {U} or {R}. Shivan Reef deals 1 damage to you.",
  },
  {
    name: "Izzet Boilerworks",
    typeLine: "Land",
    text: "Izzet Boilerworks enters tapped.\nWhen Izzet Boilerworks enters, return a land you control to its owner's hand.\n{T}: Add {U}{R}.",
  },
  {
    name: "Temple of Epiphany",
    typeLine: "Land",
    text: "Temple of Epiphany enters tapped.\nWhen Temple of Epiphany enters, scry 1.\n{T}: Add {U} or {R}.",
  },
  {
    name: "Swiftwater Cliffs",
    typeLine: "Land",
    text: "Swiftwater Cliffs enters tapped.\nWhen Swiftwater Cliffs enters, you gain 1 life.\n{T}: Add {U} or {R}.",
  },
  {
    name: "Ketria Triome",
    typeLine: "Land — Forest Island Mountain",
    text: "({T}: Add {G}, {U}, or {R}.)\nKetria Triome enters tapped.\nCycling {3} ({3}, Discard this card: Draw a card.)",
    keywords: ["Cycling"],
  },
  {
    name: "Canyon Slough",
    typeLine: "Land — Swamp Mountain",
    text: "({T}: Add {B} or {R}.)\nCanyon Slough enters tapped.\nCycling {2} ({2}, Discard this card: Draw a card.)",
    keywords: ["Cycling"],
  },
  {
    name: "Raging Ravine",
    typeLine: "Land",
    text: 'Raging Ravine enters tapped.\n{T}: Add {R} or {G}.\n{2}{R}{G}: Until end of turn, Raging Ravine becomes a 3/3 red and green Elemental creature with "Whenever this creature attacks, put a +1/+1 counter on it." It\'s still a land.',
  },
  {
    name: "Riverglide Pathway // Lavaglide Pathway",
    typeLine: "Land // Land",
    layout: "modal_dfc",
    text: "{T}: Add {U}.",
    backFace: { name: "Lavaglide Pathway", text: "{T}: Add {R}." },
  },
  { name: "Mountain", typeLine: "Basic Land — Mountain", text: "({T}: Add {R}.)" },
];

const SPELLS: readonly TestCard[] = [
  {
    name: "Serra Angel",
    typeLine: "Creature — Angel",
    text: "Flying, vigilance",
    keywords: ["Flying", "Vigilance"],
    manaCost: "{3}{W}{W}",
    manaValue: 5,
    power: "4",
    toughness: "4",
  },
  {
    name: "Warded Wurm",
    typeLine: "Creature — Wurm",
    text: "Ward {2} (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)",
    keywords: ["Ward"],
    manaValue: 6,
    power: "6",
    toughness: "6",
  },
  {
    name: "Sky Courier",
    typeLine: "Creature — Bird",
    text: "Flying (This creature can't be blocked except by creatures with flying or reach.)\nWhen this creature dies, draw a card.",
    keywords: ["Flying"],
    manaValue: 3,
    power: "3",
    toughness: "1",
  },
  {
    name: "Jolene, the Plunder Queen",
    typeLine: "Legendary Creature — Human Warlock",
    text: "Whenever a player attacks one or more of your opponents, that attacking player creates a Treasure token.\nSacrifice five Treasures: You gain 5 life and put four +1/+1 counters on Jolene. Activate only as a sorcery.",
    manaCost: "{1}{R}{G}",
    manaValue: 3,
    power: "2",
    toughness: "2",
    roleTags: ["ramp"],
    themeTags: ["tokens"],
  },
  {
    name: "Izzet Charm",
    typeLine: "Instant",
    text: "Choose one —\n• Counter target noncreature spell unless its controller pays {2}.\n• Izzet Charm deals 2 damage to target creature.\n• Draw two cards, then discard two cards.",
    manaCost: "{U}{R}",
    manaValue: 2,
    roleTags: ["counter", "removal"],
  },
  {
    name: "Battle Cleric",
    typeLine: "Creature — Human Cleric",
    text: "",
    manaCost: "{R/G}{R/G}",
    manaValue: 2,
    power: "1",
    toughness: "3",
  },
  {
    name: "Gutless Pirate",
    typeLine: "Creature — Goblin Pirate",
    text: "",
    manaCost: "{1}{G/P}",
    manaValue: 2,
    power: "2",
    toughness: "1",
    legalities: { commander: "banned", vintage: "restricted" },
  },
  // Commander brackets (design doc 31): stored as the sync stores them.
  {
    name: "Rhystic Study",
    typeLine: "Enchantment",
    text: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
    manaCost: "{2}{U}",
    manaValue: 3,
    isGameChanger: true,
  },
  {
    name: "Blood Moon",
    typeLine: "Enchantment",
    text: "Nonbasic lands are Mountains.",
    manaCost: "{2}{R}",
    manaValue: 3,
    bracketFlags: ["landDenial"],
  },
  {
    name: "Time Warp",
    typeLine: "Sorcery",
    text: "Target player takes an extra turn after this one.",
    manaCost: "{3}{U}{U}",
    manaValue: 5,
    bracketFlags: ["extraTurn"],
  },
];

beforeAll(async () => {
  await loadFixtureCatalog();
  await resetPlayers(["jack"]);
  await db.execute(sql`
    insert into card_sets (code, name, release_date, type, keyrune_code, is_enabled)
    values ('TST', 'Search test', '2024-01-01', 'expansion', 'tst', true)`);
  for (const card of [...LANDS, ...SPELLS]) await add(card);
});

describe("land cycles (rule 17)", () => {
  it.each([
    ["dual", ["Volcanic Island"]],
    ["shockland", ["Steam Vents"]],
    ["fetchland", ["Scalding Tarn"]],
    ["checkland", ["Sulfur Falls"]],
    ["fastland", ["Spirebluff Canal"]],
    ["slowland", ["Stormcarved Coast"]],
    ["painland", ["Shivan Reef"]],
    ["bounceland", ["Izzet Boilerworks"]],
    ["scryland", ["Temple of Epiphany"]],
    ["gainland", ["Swiftwater Cliffs"]],
    ["triome", ["Ketria Triome"]],
    ["cycleland", ["Canyon Slough"]],
    ["manland", ["Raging Ravine"]],
    ["pathway", ["Riverglide Pathway // Lavaglide Pathway"]],
    ["basic", ["Mountain"]],
  ])("is:%s finds its cycle and nothing else", async (cycle, names) => {
    expect(await find(`is:${cycle}`)).toEqual(names);
  });

  it("is:fetchable finds every land with a basic land type", async () => {
    expect(await find("is:fetchable")).toEqual([
      "Canyon Slough",
      "Ketria Triome",
      "Mountain",
      "Steam Vents",
      "Volcanic Island",
    ]);
  });
});

describe("kinds of card", () => {
  it("finds French vanilla creatures: keywords only", async () => {
    expect(await find("is:frenchvanilla")).toEqual(["Serra Angel", "Warded Wurm"]);
  });

  it("finds modal spells, party and outlaw creatures, hybrid and Phyrexian costs", async () => {
    expect(await find("is:modal")).toEqual(["Izzet Charm"]);
    expect(await find("is:party")).toEqual(["Battle Cleric"]);
    expect(await find("is:outlaw")).toEqual(["Gutless Pirate", "Jolene, the Plunder Queen"]);
    expect(await find("is:hybrid")).toEqual(["Battle Cleric"]);
    expect(await find("is:phyrexian")).toEqual(["Gutless Pirate"]);
  });
});

describe("numbers", () => {
  it("compares two numbers on the same card", async () => {
    expect(await find("pow>tou")).toEqual(["Gutless Pirate", "Sky Courier"]);
    expect(await find("tou>pow")).toEqual(["Battle Cleric"]);
    expect(await find("pow=tou t:creature")).toEqual([
      "Jolene, the Plunder Queen",
      "Serra Angel",
      "Warded Wurm",
    ]);
    expect(await find("pow>=mv")).toEqual(["Gutless Pirate", "Sky Courier", "Warded Wurm"]);
  });

  it("finds even and odd mana values", async () => {
    expect(await find("mv:odd -t:land")).toEqual([
      "Blood Moon",
      "Jolene, the Plunder Queen",
      "Rhystic Study",
      "Serra Angel",
      "Sky Courier",
      "Time Warp",
    ]);
    expect(await find("mv:even -t:land")).toEqual([
      "Battle Cleric",
      "Gutless Pirate",
      "Izzet Charm",
      "Warded Wurm",
    ]);
  });
});

describe("rules text", () => {
  it("reads ~ as the card's name, its short name, or 'this creature' (and the like)", async () => {
    expect(await find('o:"counters on ~"')).toEqual(["Jolene, the Plunder Queen"]);
    expect(await find('o:"when ~ dies"')).toEqual(["Sky Courier"]);
    expect(await find('o:"~ deals 2 damage"')).toEqual(["Izzet Charm"]);
    expect(await find("o:/^~ enters tapped/")).toEqual([
      "Izzet Boilerworks",
      "Raging Ravine",
      "Spirebluff Canal",
      "Stormcarved Coast",
      "Sulfur Falls",
      "Swiftwater Cliffs",
      "Temple of Epiphany",
    ]);
  });

  it("reads \\b in a pattern as a word boundary", async () => {
    expect(await find(String.raw`o:/\bdies\b/`)).toEqual(["Sky Courier"]);
    expect(await find(String.raw`o:/\bcharm\b/`)).toEqual(["Izzet Charm"]);
  });

  it("leaves reminder text out of o: and keeps it in fo: (rule 18)", async () => {
    expect(await find('o:"can\'t be blocked"')).toEqual([]);
    expect(await find('fo:"can\'t be blocked"')).toEqual(["Sky Courier"]);
  });
});

describe("tags, themes and legality", () => {
  it("finds stored role tags and themes, also through tagger names", async () => {
    expect(await find("tag:ramp")).toEqual(["Jolene, the Plunder Queen"]);
    expect(await find("theme:tokens")).toEqual(["Jolene, the Plunder Queen"]);
    expect(await find("otag:counterspell")).toEqual(["Izzet Charm"]);
    expect(await find("tag:removal -tag:counter")).toEqual([]);
  });

  it("finds Game Changers, land denial and extra turns (design doc 31)", async () => {
    expect(await find("is:gamechanger")).toEqual(["Rhystic Study"]);
    expect(await find("is:gc")).toEqual(["Rhystic Study"]);
    expect(await find("is:landdenial")).toEqual(["Blood Moon"]);
    expect(await find("is:extraturn")).toEqual(["Time Warp"]);
    expect(await find("t:enchantment -is:gc")).toEqual(["Blood Moon"]);
  });

  it("finds banned and restricted cards", async () => {
    expect(await find("banned:commander")).toEqual(["Gutless Pirate"]);
    expect(await find("restricted:vintage")).toEqual(["Gutless Pirate"]);
    expect(await find("banned:modern")).toEqual([]);
  });
});
