import {
  FINISHES,
  PrintingId,
  SetCode,
  type BoosterConfig,
  type BoosterSheet,
  type Color,
  type Finish,
  type Rarity,
} from "@/modules/catalog";
import { Cents } from "@/shared/kernel";
import { factsLookup, type FactsLookup, type PrintingFacts } from "../domain/pack";

// A small, made-up booster whose odds are easy to work out by hand, for the engine's tests.
// Each sheet type the real data uses appears once: random, foil, duplicates allowed, fixed,
// and color balanced.

type SampleCard = {
  id: string;
  rarity: Rarity;
  colors?: Color[];
  finishes?: Finish[];
  isBasicLand?: boolean;
  price?: Partial<Record<Finish, number>>; // in cents
};

// Ten mono-colored commons (two of each color) and two colorless ones.
const COMMONS: SampleCard[] = [
  ...(["W", "U", "B", "R", "G"] as const).flatMap((color) => [
    { id: `c-${color}1`, rarity: "common" as const, colors: [color], price: { nonfoil: 5 } },
    { id: `c-${color}2`, rarity: "common" as const, colors: [color], price: { nonfoil: 8 } },
  ]),
  { id: "c-artifact", rarity: "common", price: { nonfoil: 10, foil: 40 } },
  { id: "c-foilonly", rarity: "common", finishes: ["foil"], price: { foil: 90 } },
];

const UNCOMMONS: SampleCard[] = [1, 2, 3, 4].map((n) => ({
  id: `u-${n}`,
  rarity: "uncommon",
  colors: ["G"],
  price: { nonfoil: 10 * n, foil: 30 * n },
}));

const RARES: SampleCard[] = [
  { id: "r-1", rarity: "rare", price: { nonfoil: 100, foil: 300 } },
  { id: "r-2", rarity: "rare", price: { nonfoil: 50 } },
  { id: "m-1", rarity: "mythic", price: { nonfoil: 1500, foil: 4000 } },
  { id: "m-etched", rarity: "mythic", finishes: ["etched"], price: { etched: 2500 } },
];

const LANDS: SampleCard[] = [
  { id: "l-forest", rarity: "common", colors: [], isBasicLand: true, price: { nonfoil: 1 } },
  { id: "l-island", rarity: "common", colors: [], isBasicLand: true, price: { nonfoil: 2 } },
];

const ALL_CARDS = [...COMMONS, ...UNCOMMONS, ...RARES, ...LANDS];

/** A sheet with these [printing id, weight] pairs; every flag off unless given. */
export function sampleSheet(
  cards: Array<[string, number]>,
  flags: Partial<Omit<BoosterSheet, "cards">> = {},
): BoosterSheet {
  return {
    cards: cards.map(([id, weight]) => ({ printingId: PrintingId.of(id), weight })),
    isFoil: false,
    allowDuplicates: false,
    balanceColors: false,
    isFixed: false,
    ...flags,
  };
}

function evenly(cards: SampleCard[]): Array<[string, number]> {
  return cards.map((card) => [card.id, 1]);
}

/**
 * Two layouts of 14 cards. 3 in 4 packs have a basic land; 1 in 4 have a foil instead.
 * Rare slot: rares weigh 3 each and mythics 1 each, so a mythic is 2 in 8 = 25%.
 * Six commons from a color-balanced sheet of ten mono-colored cards and one colorless card.
 */
export const SAMPLE_BOOSTER: BoosterConfig = {
  setCode: SetCode.of("TST"),
  boosterType: "play",
  variants: [
    { weight: 3, slots: { common: 6, uncommon: 3, rareMythic: 1, land: 1, starter: 3 } },
    { weight: 1, slots: { common: 6, uncommon: 3, rareMythic: 1, foil: 1, starter: 3 } },
  ],
  sheets: {
    common: sampleSheet(evenly(COMMONS.filter((card) => card.id !== "c-foilonly")), {
      balanceColors: true,
    }),
    uncommon: sampleSheet(evenly(UNCOMMONS)),
    rareMythic: sampleSheet([
      ["r-1", 3],
      ["r-2", 3],
      ["m-1", 1],
      ["m-etched", 1],
    ]),
    land: sampleSheet(evenly(LANDS), { allowDuplicates: true }),
    // A tiny fixed "starter": the artifact twice, then Forest once.
    starter: sampleSheet(
      [
        ["c-artifact", 2],
        ["l-forest", 1],
      ],
      { isFixed: true },
    ),
    foil: sampleSheet(evenly([...COMMONS, ...UNCOMMONS, ...RARES]), { isFoil: true }),
  },
  sourceSetCodes: [SetCode.of("TST")],
};

function toFacts(card: SampleCard): PrintingFacts {
  const marketPrice: Partial<Record<Finish, Cents>> = {};
  for (const finish of FINISHES) {
    const cents = card.price?.[finish];
    if (cents !== undefined) marketPrice[finish] = Cents.of(cents);
  }
  return {
    name: card.id,
    collectorNumber: String(ALL_CARDS.indexOf(card) + 1),
    rarity: card.rarity,
    colors: card.colors ?? [],
    finishes: card.finishes ?? ["nonfoil", "foil"],
    isBasicLand: card.isBasicLand ?? false,
    marketPrice,
  };
}

export const SAMPLE_FACTS: ReadonlyMap<PrintingId, PrintingFacts> = new Map(
  ALL_CARDS.map((card) => [PrintingId.of(card.id), toFacts(card)]),
);

export const sampleFacts: FactsLookup = factsLookup(SAMPLE_FACTS);

/** The sample booster with one sheet replaced (or added), for testing one kind of sheet alone. */
export function withSheet(
  name: string,
  sheet: BoosterSheet,
  slots: Readonly<Record<string, number>>,
): BoosterConfig {
  return {
    ...SAMPLE_BOOSTER,
    variants: [{ weight: 1, slots }],
    sheets: { ...SAMPLE_BOOSTER.sheets, [name]: sheet },
  };
}

/** A printing id for tests (domain code may only import catalog types, not its constructors). */
export function samplePrintingId(raw: string): PrintingId {
  return PrintingId.of(raw);
}
