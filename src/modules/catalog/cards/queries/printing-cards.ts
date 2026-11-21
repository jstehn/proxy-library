import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { Cents } from "@/shared/kernel";
import type { CardFace, Finish } from "../domain/types";

// The shape of a printing as the screens show it, and the one query that loads it by id. Not a
// public read (`queries/index.ts` doesn't list this file): the public reads that return printings
// (`setPrintings`, `printingDetail`) call it, and so does the `printingDetails` capability.

export type PrintingCard = Readonly<{
  id: string;
  name: string;
  collectorNumber: string;
  rarity: string;
  variantLabel: string;
  finishes: Finish[];
  hasImage: boolean;
  /** Whether it has a second card face with its own image (double-faced cards, not split ones). */
  hasBackImage: boolean;
  /** What's printed on each face (front first), for the hover overlay. */
  faces: CardFace[];
  artist: string | null;
  setCode: string;
  /** Scryfall's layout: "normal", "split", "adventure", "transform", … */
  layout: string;
  colors: string[];
  /** Colors of mana it makes ("W", …, "C"), e.g. for a land's colour on a playtest proxy. */
  producedMana: string[];
  /** Latest market price per finish; a finish is missing when there's no price. */
  prices: Partial<Record<Finish, Cents>>;
}>;

export type PrintingCardRow = {
  id: string;
  name: string;
  collector_number: string;
  rarity: string;
  variant_label: string;
  finishes: Finish[];
  has_image: boolean;
  has_back_image: boolean;
  faces: CardFace[];
  artist: string | null;
  set_code: string;
  layout: string;
  colors: string[];
  produced_mana: string[];
  prices: Record<string, number> | null;
};

/** The columns of a PrintingCard, for printings aliased "p". */
export const PRINTING_CARD_COLUMNS = sql`
  p.id, p.name, p.collector_number, p.rarity, p.variant_label, p.finishes,
  p.image_uris is not null as has_image,
  coalesce(jsonb_typeof(p.image_uris->'back') = 'object', false) as has_back_image,
  p.faces, p.artist, p.set_code, p.layout, p.colors, p.produced_mana,
  -- For each finish, the newest snapshot's price ("distinct on" keeps the first row per finish).
  (select jsonb_object_agg(latest.finish, latest.usd_cents)
     from (select distinct on (s.finish) s.finish, s.usd_cents
             from price_snapshots s
            where s.printing_id = p.id
            order by s.finish, s.day desc) latest) as prices`;

export function toPrintingCard(row: PrintingCardRow): PrintingCard {
  return {
    id: row.id,
    name: row.name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    variantLabel: row.variant_label,
    finishes: row.finishes,
    hasImage: row.has_image,
    hasBackImage: row.has_back_image,
    faces: row.faces,
    artist: row.artist,
    setCode: row.set_code,
    layout: row.layout,
    colors: row.colors,
    producedMana: row.produced_mana,
    prices: Object.fromEntries(
      Object.entries(row.prices ?? {}).map(([finish, cents]) => [finish, Cents.of(Number(cents))]),
    ),
  };
}

/** These printings (any set), by id. Ids the catalog doesn't have are left out. */
export async function printingCards(
  db: DbExecutor,
  ids: readonly string[],
): Promise<Map<string, PrintingCard>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<PrintingCardRow>(sql`
    select ${PRINTING_CARD_COLUMNS}
      from printings p
     where p.id = any(${sql.param([...new Set(ids)])}::text[])
  `);
  return new Map(rows.rows.map((row) => [row.id, toPrintingCard(row)]));
}
