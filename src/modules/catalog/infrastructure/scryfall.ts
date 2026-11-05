// Anti-corruption layer for Scryfall (ADR 0007): the fields we use, and a pure mapper.
import { z } from "zod";
import { Cents } from "@/shared/kernel";
import {
  SetCode,
  type CardFace,
  type ImageUris,
  type ScryfallCard,
  type TokenPrinting,
} from "../domain/types";

const ImageSizes = z
  .object({
    small: z.string(),
    normal: z.string(),
    large: z.string(),
    art_crop: z.string().optional(),
  })
  .transform(({ art_crop, ...sizes }) => ({ ...sizes, artCrop: art_crop }));

/** What's printed on a face; Scryfall leaves out what a card doesn't have. */
const PrintedFields = {
  name: z.string().default(""),
  mana_cost: z.string().optional(),
  type_line: z.string().default(""),
  oracle_text: z.string().optional(),
  power: z.string().optional(),
  toughness: z.string().optional(),
  loyalty: z.string().optional(),
  defense: z.string().optional(),
};

/** One entry of `all_parts`: a card related to this one (design doc 25 uses the tokens). */
const RelatedCard = z.object({ id: z.string(), component: z.string() });

export const ScryfallCardSchema = z.object({
  id: z.string(),
  // Text and links, read for tokens (design doc 25): a printing's own text comes from MTGJSON.
  // All optional, so a card missing one is still read for its prices and images.
  oracle_id: z.string().optional(),
  ...PrintedFields,
  layout: z.string().default("normal"),
  released_at: z.string().default(""),
  collector_number: z.string().default(""),
  colors: z.array(z.string()).optional(),
  artist: z.string().optional(),
  all_parts: z.array(RelatedCard).optional(),
  set: z.string(),
  set_type: z.string(),
  digital: z.boolean().default(false),
  lang: z.string(),
  legalities: z.record(z.string(), z.string()).default({}),
  // Colors of mana the card can make (lands, rocks, dorks), for deck statistics (design doc 14).
  produced_mana: z.array(z.string()).optional(),
  // Keyword abilities and actions ("Flying", "Scry"), for `kw:` searches (design doc 15).
  keywords: z.array(z.string()).optional(),
  prices: z.object({
    usd: z.string().nullable().default(null),
    usd_foil: z.string().nullable().default(null),
    usd_etched: z.string().nullable().default(null),
  }),
  image_uris: ImageSizes.optional(),
  card_faces: z
    .array(
      z.object({
        ...PrintedFields,
        colors: z.array(z.string()).optional(),
        image_uris: ImageSizes.optional(),
      }),
    )
    .optional(),
});
export type ScryfallCardJson = z.infer<typeof ScryfallCardSchema>;

/** Response of GET /bulk-data/default-cards. */
export const ScryfallBulkDataSchema = z.object({
  updated_at: z.string(),
  jsonl_download_uri: z.string(),
});

/** Response of POST /cards/collection. */
export const ScryfallCollectionSchema = z.object({
  data: z.array(ScryfallCardSchema),
  not_found: z.array(z.unknown()).default([]),
});

function mapImages(raw: ScryfallCardJson): ImageUris | null {
  if (raw.image_uris !== undefined) return { front: raw.image_uris, back: null };
  const [front, back] = raw.card_faces ?? [];
  if (front?.image_uris === undefined) return null; // no image yet (e.g. very new cards)
  return { front: front.image_uris, back: back?.image_uris ?? null };
}

/** Layouts that are tokens wherever they're printed. */
const TOKEN_LAYOUTS = new Set(["token", "double_faced_token", "emblem"]);

type PrintedJson = Readonly<{
  name: string;
  mana_cost?: string;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
}>;

function mapFace(raw: PrintedJson): CardFace {
  return {
    name: raw.name,
    // Tokens have no cost; Scryfall writes "" for that.
    manaCost: raw.mana_cost === undefined || raw.mana_cost === "" ? null : raw.mana_cost,
    typeLine: raw.type_line,
    text: raw.oracle_text ?? "",
    power: raw.power ?? null,
    toughness: raw.toughness ?? null,
    loyalty: raw.loyalty ?? null,
    defense: raw.defense ?? null,
  };
}

/**
 * The card as a token printing, if it is one we keep: a paper, English token, emblem or helper
 * card (a token layout, or anything in a token set, like The Monarch). Null otherwise.
 */
function mapToken(raw: ScryfallCardJson): TokenPrinting | null {
  const isToken = TOKEN_LAYOUTS.has(raw.layout) || raw.set_type === "token";
  if (!isToken || raw.digital || raw.lang !== "en" || raw.oracle_id === undefined) return null;
  const faces = raw.card_faces?.map(mapFace) ?? [mapFace(raw)];
  return {
    id: raw.id,
    oracleId: raw.oracle_id,
    name: raw.name,
    setCode: raw.set,
    collectorNumber: raw.collector_number,
    layout: raw.layout,
    // A double-faced token keeps its colours on its faces; the front's are the token's.
    colors: raw.colors ?? raw.card_faces?.[0]?.colors ?? [],
    faces,
    artist: raw.artist ?? null,
    images: mapImages(raw),
    releasedAt: raw.released_at,
  };
}

/**
 * What may be tokens this card makes (design doc 25). Scryfall lists tokens as "token", but
 * emblems and helper cards (The Monarch, the Initiative) as "combo_piece", next to ordinary
 * cards (partners, the card itself). The sync keeps only the ids that are token printings.
 */
function relatedTokenIds(raw: ScryfallCardJson): string[] {
  return (raw.all_parts ?? [])
    .filter((part) => part.component === "token" || part.component === "combo_piece")
    .filter((part) => part.id !== raw.id)
    .map((part) => part.id);
}

export function mapScryfallCard(raw: ScryfallCardJson): ScryfallCard {
  return {
    scryfallId: raw.id,
    setCode: SetCode.of(raw.set),
    setType: raw.set_type,
    isDigital: raw.digital,
    language: raw.lang,
    isStandardLegal: raw.legalities.standard === "legal",
    isBasicLand: raw.type_line.includes("Basic Land"),
    prices: {
      nonfoil: Cents.fromUsd(raw.prices.usd),
      foil: Cents.fromUsd(raw.prices.usd_foil),
      etched: Cents.fromUsd(raw.prices.usd_etched),
    },
    images: mapImages(raw),
    legalities: raw.legalities,
    producedMana: (raw.produced_mana ?? []).filter((symbol) => /^[WUBRGC]$/.test(symbol)),
    keywords: raw.keywords ?? [],
    tokenIds: relatedTokenIds(raw),
    token: mapToken(raw),
  };
}
