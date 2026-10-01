// Anti-corruption layer for Scryfall (ADR 0007): the fields we use, and a pure mapper.
import { z } from "zod";
import { Cents } from "@/shared/kernel";
import { SetCode, type ImageUris, type ScryfallCard } from "../domain/types";

const ImageSizes = z.object({ small: z.string(), normal: z.string(), large: z.string() });

export const ScryfallCardSchema = z.object({
  id: z.string(),
  set: z.string(),
  set_type: z.string(),
  digital: z.boolean().default(false),
  lang: z.string(),
  type_line: z.string().default(""),
  legalities: z.record(z.string(), z.string()).default({}),
  // Colors of mana the card can make (lands, rocks, dorks), for deck statistics (design doc 14).
  produced_mana: z.array(z.string()).optional(),
  prices: z.object({
    usd: z.string().nullable().default(null),
    usd_foil: z.string().nullable().default(null),
    usd_etched: z.string().nullable().default(null),
  }),
  image_uris: ImageSizes.optional(),
  card_faces: z.array(z.object({ image_uris: ImageSizes.optional() })).optional(),
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
  };
}
