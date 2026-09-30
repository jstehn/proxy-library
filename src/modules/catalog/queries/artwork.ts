import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";

// Read models for official product photos and key art (design doc 13, section 9).

/**
 * The downloaded photos each product shows, in order (artwork image ids). A product missing
 * from the map shows generated art.
 */
export async function productPhotos(
  db: DbExecutor,
  productIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.execute<{ product_id: string; photo_ids: string[] }>(sql`
    select l.product_id,
           (select coalesce(jsonb_agg(image->>'id' order by position), '[]'::jsonb)
              from jsonb_array_elements(w.images) with ordinality as photos(image, position)
             where (l.photo = 'variants' or (l.photo = 'one' and position - 1 = l.photo_index))
               and image->>'id' in (select image_id from artwork_files)) as photo_ids
      from product_wpn_links l
      join wpn_products w on w.set_code = l.wpn_set_code and w.name = l.wpn_name
     where l.product_id = any(${sql.param([...productIds])}::text[])
  `);
  return new Map(
    rows.rows
      .filter((row) => row.photo_ids.length > 0)
      .map((row) => [row.product_id, row.photo_ids]),
  );
}

/** A booster pack by its set and type, e.g. "BLB/play". */
export const packKey = (setCode: string, boosterType: string) => `${setCode}/${boosterType}`;

/**
 * The photos of loose packs (from a box, say), keyed by `packKey`: those of the product that is
 * exactly one such pack.
 */
export async function packPhotos(
  db: DbExecutor,
  packs: ReadonlyArray<{ setCode: string; boosterType: string }>,
): Promise<Map<string, string[]>> {
  const photos = new Map<string, string[]>();
  for (const pack of packs) {
    const key = packKey(pack.setCode, pack.boosterType);
    if (photos.has(key)) continue;
    const contents = JSON.stringify([
      { kind: "pack", setCode: pack.setCode, boosterType: pack.boosterType },
    ]);
    const [product] = (
      await db.execute<{ id: string }>(sql`
        select id from sealed_products
         where contents = ${contents}::jsonb and is_listed
         order by id limit 1
      `)
    ).rows;
    if (product === undefined) continue;
    const found = (await productPhotos(db, [product.id])).get(product.id);
    if (found) photos.set(key, found);
  }
  return photos;
}

/** One set's WPN page, for Admin → Catalog → Photos. */
export type SetPhotosView = Readonly<{
  setCode: string;
  setName: string;
  status: "found" | "no_page" | "unreadable" | "not_read";
  slug: string | null;
  slugOverride: string | null;
  error: string | null;
  checkedAt: string | null;
  keyArtId: string | null;
  /** What the page offers: its products, with each photo's id (null if not downloaded). */
  offers: ReadonlyArray<{
    name: string;
    msrpCents: number | null;
    photos: ReadonlyArray<string | null>;
  }>;
  /** Our listed products (and the Commander companions'), with how each was matched. */
  products: ReadonlyArray<{
    id: string;
    name: string;
    wpnName: string | null;
    match: "by_name" | "by_kind" | "admin" | null;
    photo: "variants" | "one" | "none" | null;
    photoIndex: number | null;
    photoIds: readonly string[];
  }>;
}>;

/** Every enabled main set's WPN status, for the admin overview. */
export async function photosOverview(db: DbExecutor): Promise<
  Array<{
    setCode: string;
    setName: string;
    status: SetPhotosView["status"];
    withPhoto: number;
    products: number;
  }>
> {
  const rows = await db.execute<{
    set_code: string;
    set_name: string;
    status: SetPhotosView["status"] | null;
    with_photo: number;
    products: number;
  }>(sql`
    select s.code as set_code, s.name as set_name, pg.status,
           count(sp.id) filter (where l.photo in ('variants', 'one'))::int as with_photo,
           count(sp.id)::int as products
      from card_sets s
      left join wpn_pages pg on pg.set_code = s.code
      left join card_sets companion on companion.parent_code = s.code and companion.type = 'commander'
      left join sealed_products sp on sp.set_code in (s.code, companion.code) and sp.is_listed
      left join product_wpn_links l on l.product_id = sp.id
     where s.is_enabled and s.type <> 'commander'
     group by s.code, s.name, s.release_date, pg.status
     order by s.release_date desc
  `);
  return rows.rows.map((row) => ({
    setCode: row.set_code,
    setName: row.set_name,
    status: row.status ?? "not_read",
    withPhoto: row.with_photo,
    products: row.products,
  }));
}

/** One set's page and products, for the admin to check and correct. */
export async function setPhotos(db: DbExecutor, setCode: string): Promise<SetPhotosView | null> {
  const code = setCode.toUpperCase();
  const [set] = (
    await db.execute<{
      name: string;
      status: SetPhotosView["status"] | null;
      slug: string | null;
      slug_override: string | null;
      error: string | null;
      checked_at: Date | null;
      key_art_id: string | null;
    }>(sql`
      select s.name, pg.status, pg.slug, pg.slug_override, pg.error, pg.checked_at,
             case when pg.key_art->>'id' in (select image_id from artwork_files)
                  then pg.key_art->>'id' end as key_art_id
        from card_sets s left join wpn_pages pg on pg.set_code = s.code
       where s.code = ${code}
    `)
  ).rows;
  if (set === undefined) return null;

  const offers = await db.execute<{
    name: string;
    msrp_cents: number | null;
    photos: Array<string | null>;
  }>(sql`
    select w.name, w.msrp_cents,
           (select coalesce(jsonb_agg(
                     case when image->>'id' in (select image_id from artwork_files)
                          then image->>'id' end order by position), '[]'::jsonb)
              from jsonb_array_elements(w.images) with ordinality as photos(image, position)) as photos
      from wpn_products w where w.set_code = ${code} order by w.position
  `);
  const products = await db.execute<{
    id: string;
    name: string;
    wpn_name: string | null;
    match: SetPhotosView["products"][number]["match"];
    photo: SetPhotosView["products"][number]["photo"];
    photo_index: number | null;
  }>(sql`
    select sp.id, sp.name, l.wpn_name, l.match, l.photo, l.photo_index
      from sealed_products sp
      join card_sets s on s.code = sp.set_code
      left join product_wpn_links l on l.product_id = sp.id
     where (s.code = ${code} or (s.parent_code = ${code} and s.type = 'commander'))
       and sp.is_listed and jsonb_array_length(sp.contents) > 0
     order by l.photo is null, l.photo, sp.name
  `);
  const photos = await productPhotos(
    db,
    products.rows.map((row) => row.id),
  );

  return {
    setCode: code,
    setName: set.name,
    status: set.status ?? "not_read",
    slug: set.slug,
    slugOverride: set.slug_override,
    error: set.error,
    checkedAt: set.checked_at === null ? null : new Date(set.checked_at).toISOString(),
    keyArtId: set.key_art_id,
    offers: offers.rows.map((row) => ({
      name: row.name,
      msrpCents: row.msrp_cents,
      photos: row.photos,
    })),
    products: products.rows.map((row) => ({
      id: row.id,
      name: row.name,
      wpnName: row.wpn_name,
      match: row.match,
      photo: row.photo,
      photoIndex: row.photo_index,
      photoIds: photos.get(row.id) ?? [],
    })),
  };
}
