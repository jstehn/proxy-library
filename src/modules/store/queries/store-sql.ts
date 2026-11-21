import { sql } from "drizzle-orm";

// Read models for the store screens (ADR 0006). Prices follow design doc 06, rule 1 (a product's
// own override, else its official MSRP, else its kind's price; no price means not for sale),
// raised to what the contents sell back for (design doc 27, ADR 0021).

/** The kind key of a sealed product row aliased "sp", in SQL (matches productKind()). */
export const KIND = sql`sp.category || '/' || coalesce(sp.subtype, 'default')`;
/**
 * A product's list price in SQL: its override, else Wizards' official MSRP, else its kind's
 * price (null = no price). ADR 0014, amended by ADR 0015.
 */
export const LIST_PRICE = sql`coalesce(o.cents, w.msrp_cents, k.cents)`;
/** What its contents sell back for, rounded up (ADR 0021); null before the first valuation. */
export const RESALE_FLOOR = sql`ceil(v.value_cents * ss.buylist_rate_bps / 10000.0)::bigint`;
/**
 * The store price in SQL (design doc 27): an override as typed; in MSRP pricing (design doc 33,
 * the default) any list price (official MSRP or kind price) as published; in value-based pricing
 * the list price raised to the resale floor, and a product priced only by its kind waits for its
 * first valuation. The same rule as `storePrice` in domain/pricing.ts; an integration test checks
 * they agree.
 */
export const MSRP = sql`(case
  when o.cents is not null then o.cents
  when coalesce(w.msrp_cents, k.cents) is null then null
  when ss.pricing_mode = 'msrp' then coalesce(w.msrp_cents, k.cents)
  when w.msrp_cents is null and v.value_cents is null then null
  else greatest(coalesce(w.msrp_cents, k.cents), coalesce(${RESALE_FLOOR}, 0))
end)`;
/** Only listed products with something inside are for sale (design doc 06, rule 2; 11). */
export const HAS_CONTENTS = sql`sp.is_listed and jsonb_array_length(sp.contents) > 0`;
/**
 * A case, display or "Set of N" never takes its kind's price (mirrors `kindPriceApplies` in
 * domain/pricing.ts).
 */
export const IS_MULTIPLE = sql`sp.name ~* '\\m(case|display|set of \\d+)\\M'`;
export const PRICE_JOINS = sql`
  left join msrp_overrides o on o.product_id = sp.id
  left join msrp_prices k on k.kind = ${KIND} and not ${IS_MULTIPLE}
  left join product_wpn_links l on l.product_id = sp.id
  left join wpn_products w on w.set_code = l.wpn_set_code and w.name = l.wpn_name
  left join product_values v on v.product_id = sp.id
  left join store_settings ss on ss.id = 1`;

/**
 * A set's key art (from WPN), once downloaded: an artwork image id, or null. A Commander
 * companion set has no WPN page of its own, so it shows its main set's.
 */
export const KEY_ART = sql`(
  select pg.key_art->>'id' from wpn_pages pg
   where pg.set_code = case when s.type = 'commander' then coalesce(s.parent_code, s.code)
                            else s.code end
     and pg.key_art->>'id' in (select image_id from artwork_files)
)`;

/**
 * A product's photos (design doc 13): the downloaded WPN photos its link says to show, in order.
 * "variants" shows them all (one per owned item); "one" shows the admin's pick; "none", nothing.
 */
export const PHOTO_IDS = sql`(
  select coalesce(jsonb_agg(image->>'id' order by position), '[]'::jsonb)
    from jsonb_array_elements(w.images) with ordinality as photos(image, position)
   where (l.photo = 'variants' or (l.photo = 'one' and position - 1 = l.photo_index))
     and image->>'id' in (select image_id from artwork_files)
)`;

/**
 * For a deck product, the first commander of its deck list, so its generated art can feature
 * that card (design doc 13, decision 1). Null for other products.
 */
export const COMMANDER_PRINTING = sql`(
  select card->>'printingId'
    from jsonb_array_elements(sp.contents) as item
    join deck_lists d on d.set_code = item->>'setCode' and d.name = item->>'deckName'
    cross join jsonb_array_elements(d.cards) as card
   where item->>'kind' = 'deck' and card->>'board' = 'commander'
   limit 1
)`;
