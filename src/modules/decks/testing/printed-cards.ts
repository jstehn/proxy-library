import { MANA_COLORS } from "../domain/mana-symbols";
import type { PrintedCard, PrintedFace } from "../domain/playtest-card";

// Printed cards for playtest proxy tests (design doc 22), from one-line overrides.

export function printedFace(changes: Partial<PrintedFace> = {}): PrintedFace {
  return {
    name: "Grizzly Bears",
    manaCost: "{1}{G}",
    typeLine: "Creature — Bear",
    text: "",
    power: "2",
    toughness: "2",
    loyalty: null,
    defense: null,
    ...changes,
  };
}

export function printedCard(
  changes: Partial<PrintedCard> = {},
  faces: readonly Partial<PrintedFace>[] = [{}],
): PrintedCard {
  return {
    faces: faces.map(printedFace),
    doubleFaced: false,
    colors: [],
    producedMana: [],
    setCode: "tst",
    collectorNumber: "1",
    artist: "Test Artist",
    isToken: false,
    ...changes,
  };
}

/** Every subset of the five colours: colourless, 5 mono, 10 pairs, 10 triples, 5 fours, 1 five. */
export function allColorCombinations(): string[][] {
  return Array.from({ length: 32 }, (_, bits) =>
    MANA_COLORS.filter((_, index) => (bits & (1 << index)) !== 0),
  ).sort((one, other) => one.length - other.length);
}

/**
 * A card for each colour combination (a creature costing one of each colour), then the awkward
 * cases section 12 lists: hybrids, Phyrexian mana, X, symbols in text, lands, an artifact, long
 * text, split, adventure and double-faced cards.
 */
export function colorTestCards(): { name: string; printed: PrintedCard }[] {
  const combinations = allColorCombinations().map((colors) => {
    const name = colors.length === 0 ? "Colourless Golem" : `${colors.join("")} Test Creature`;
    const cost = `{1}${colors.map((color) => `{${color}}`).join("")}`;
    return {
      name,
      printed: printedCard({ colors }, [
        {
          name,
          manaCost: cost,
          typeLine: colors.length === 0 ? "Artifact Creature — Golem" : "Creature — Test",
          text: "Flying\n{T}: Add one mana of any color.",
        },
      ]),
    };
  });
  const special = [
    printedCard({ colors: ["W", "G"] }, [
      {
        name: "Kitchen Finks",
        manaCost: "{1}{G/W}{G/W}",
        typeLine: "Creature — Ouphe",
        text: "When this creature enters, you gain 2 life.\nPersist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)",
        power: "3",
        toughness: "2",
      },
    ]),
    printedCard({ colors: ["U", "R"] }, [
      {
        name: "Hybrid Symbol Sampler",
        manaCost: "{2/U}{C/R}{U/R/P}{X}",
        typeLine: "Sorcery",
        text: "Pay {W/P}, {Q}, {E}{E}, {S}, {C}{C} or {100}: Draw X cards. {½} {∞}",
        power: null,
        toughness: null,
      },
    ]),
    printedCard({ colors: ["G"] }, [
      {
        name: "Birthing Pod",
        manaCost: "{3}{G/P}",
        typeLine: "Artifact",
        text: "({G/P} can be paid with either {G} or 2 life.)\n{1}{G/P}, {T}, Sacrifice a creature: Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery.",
        power: null,
        toughness: null,
      },
    ]),
    printedCard({ producedMana: ["U", "W"] }, [
      {
        name: "Hallowed Fountain",
        manaCost: null,
        typeLine: "Land — Plains Island",
        text: "({T}: Add {W} or {U}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped.",
        power: null,
        toughness: null,
      },
    ]),
    printedCard({ producedMana: ["W", "U", "B", "R", "G"] }, [
      {
        name: "Command Tower",
        manaCost: null,
        typeLine: "Land",
        text: "{T}: Add one mana of any color in your commander's color identity.",
        power: null,
        toughness: null,
      },
    ]),
    printedCard({ producedMana: ["C"] }, [
      {
        name: "Sol Ring",
        manaCost: "{1}",
        typeLine: "Artifact",
        text: "{T}: Add {C}{C}.",
        power: null,
        toughness: null,
      },
    ]),
    printedCard({ colors: ["R"] }, [
      {
        name: "Fire",
        manaCost: "{1}{R}",
        typeLine: "Instant",
        text: "Fire deals 2 damage divided as you choose among one or two targets.",
        power: null,
        toughness: null,
      },
      {
        name: "Ice",
        manaCost: "{1}{U}",
        typeLine: "Instant",
        text: "Tap target permanent.\nDraw a card.",
        power: null,
        toughness: null,
      },
    ]),
    printedCard({ colors: ["R"] }, [
      {
        name: "Bonecrusher Giant",
        manaCost: "{2}{R}",
        typeLine: "Creature — Giant",
        text: "Whenever this creature becomes the target of a spell, this creature deals 2 damage to that spell's controller.",
        power: "4",
        toughness: "3",
      },
      {
        name: "Stomp",
        manaCost: "{1}{R}",
        typeLine: "Instant — Adventure",
        text: "Damage can't be prevented this turn. Stomp deals 2 damage to any target.",
        power: null,
        toughness: null,
      },
    ]),
    printedCard({ colors: ["U"], doubleFaced: true }, [
      {
        name: "Delver of Secrets",
        manaCost: "{U}",
        typeLine: "Creature — Human Wizard",
        text: "At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform this creature.",
        power: "1",
        toughness: "1",
      },
      {
        name: "Insectile Aberration",
        manaCost: null,
        typeLine: "Creature — Human Insect",
        text: "Flying",
        power: "3",
        toughness: "2",
      },
    ]),
    printedCard({ colors: ["W", "U", "B", "R", "G"] }, [
      {
        name: "Atraxa, Grand Unifier of Very Long Names",
        manaCost: "{3}{G}{W}{U}{B}",
        typeLine: "Legendary Creature — Phyrexian Angel Horror",
        text: "Flying, vigilance, deathtouch, lifelink\nWhen Atraxa enters, reveal the top ten cards of your library. For each card type, you may put a card of that type from among the revealed cards into your hand. Put the rest on the bottom of your library in a random order. (Artifact, battle, creature, enchantment, instant, land, planeswalker, and sorcery are card types.)\n{2}{W/U}, {T}: Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)",
        power: "7",
        toughness: "7",
      },
    ]),
    printedCard({ colors: ["B"] }, [
      {
        name: "Liliana of the Veil",
        manaCost: "{1}{B}{B}",
        typeLine: "Legendary Planeswalker — Liliana",
        text: "+1: Each player discards a card.\n−2: Target player sacrifices a creature.\n−6: Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.",
        power: null,
        toughness: null,
        loyalty: "3",
      },
    ]),
  ];
  return [
    ...combinations,
    ...special.map((printed) => ({
      name: printed.faces.map((face) => face.name).join(" // "),
      printed,
    })),
  ];
}
