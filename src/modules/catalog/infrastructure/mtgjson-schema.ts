import { z } from "zod";

// The parts of MTGJSON's files the catalog uses (https://mtgjson.com/data-models/).
// Zod drops every other field, so the rest of the app never sees MTGJSON's full shape.

const Meta = z.object({ version: z.string(), date: z.string() });

export const MtgjsonMetaFile = z.object({ meta: Meta, data: Meta });

const SetSummary = z.object({
  code: z.string(),
  name: z.string(),
  releaseDate: z.string(),
  type: z.string(),
  keyruneCode: z.string().default(""),
  parentCode: z.string().optional(),
  isOnlineOnly: z.boolean().default(false),
});
export type MtgjsonSetSummary = z.infer<typeof SetSummary>;

export const MtgjsonSetListFile = z.object({ meta: Meta, data: z.array(SetSummary) });

export const MtgjsonCard = z.object({
  uuid: z.string(),
  name: z.string(),
  number: z.string(),
  setCode: z.string(),
  rarity: z.string(),
  colors: z.array(z.string()).default([]),
  colorIdentity: z.array(z.string()).default([]),
  manaCost: z.string().optional(),
  manaValue: z.number().default(0),
  type: z.string(),
  layout: z.string(),
  finishes: z.array(z.string()).default([]),
  borderColor: z.string(),
  frameVersion: z.string(),
  frameEffects: z.array(z.string()).default([]),
  promoTypes: z.array(z.string()).default([]),
  isFullArt: z.boolean().default(false),
  availability: z.array(z.string()).default([]),
  identifiers: z.object({
    scryfallId: z.string().optional(),
    scryfallOracleId: z.string().optional(),
  }),
});
export type MtgjsonCard = z.infer<typeof MtgjsonCard>;

const Sheet = z.object({
  cards: z.record(z.string(), z.number()),
  foil: z.boolean(),
  totalWeight: z.number(),
  allowDuplicates: z.boolean().default(false),
  balanceColors: z.boolean().default(false),
  fixed: z.boolean().default(false),
});

const Booster = z.object({
  boosters: z.array(z.object({ contents: z.record(z.string(), z.number()), weight: z.number() })),
  boostersTotalWeight: z.number(),
  sheets: z.record(z.string(), Sheet),
  sourceSetCodes: z.array(z.string()).default([]),
});
export type MtgjsonBooster = z.infer<typeof Booster>;

// Sealed product contents are recursive ("variable" holds more contents), so the type is
// written out first and the schema refers to itself through z.lazy.
export type MtgjsonContents = {
  card?: { uuid: string; foil?: boolean; finishes?: string[] }[];
  pack?: { code: string; set: string }[];
  sealed?: { uuid: string; count: number; set: string }[];
  deck?: { name: string; set: string }[];
  other?: { name: string }[];
  variable?: { configs: MtgjsonContents[] }[];
};
const Contents: z.ZodType<MtgjsonContents> = z.lazy(() =>
  z.object({
    card: z
      .array(
        z.object({
          uuid: z.string(),
          foil: z.boolean().optional(),
          finishes: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    pack: z.array(z.object({ code: z.string(), set: z.string() })).optional(),
    sealed: z.array(z.object({ uuid: z.string(), count: z.number(), set: z.string() })).optional(),
    deck: z.array(z.object({ name: z.string(), set: z.string() })).optional(),
    other: z.array(z.object({ name: z.string() })).optional(),
    variable: z.array(z.object({ configs: z.array(Contents) })).optional(),
  }),
);

export const MtgjsonSealedProduct = z.object({
  uuid: z.string(),
  name: z.string(),
  category: z.string().default("unknown"),
  subtype: z.string().nullable().default(null),
  releaseDate: z.string().optional(),
  contents: Contents.default({}),
});
export type MtgjsonSealedProduct = z.infer<typeof MtgjsonSealedProduct>;

const DeckCard = z.object({
  uuid: z.string(),
  count: z.number(),
  isFoil: z.boolean().optional(),
  isEtched: z.boolean().optional(),
});
export const MtgjsonDeck = z.object({
  name: z.string(),
  type: z.string(),
  mainBoard: z.array(DeckCard).default([]),
  sideBoard: z.array(DeckCard).default([]),
  commander: z.array(DeckCard).default([]),
  sourceSetCodes: z.array(z.string()).default([]),
});
export type MtgjsonDeck = z.infer<typeof MtgjsonDeck>;

export const MtgjsonSetFile = z.object({
  meta: Meta,
  data: SetSummary.extend({
    cards: z.array(MtgjsonCard),
    booster: z.record(z.string(), Booster).default({}),
    sealedProduct: z.array(MtgjsonSealedProduct).default([]),
    decks: z.array(MtgjsonDeck).default([]),
  }),
});
export type MtgjsonSetFile = z.infer<typeof MtgjsonSetFile>;
