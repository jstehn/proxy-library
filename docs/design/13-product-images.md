# Design: official product photos, key art and product details (WPN)

- **Phase:** 13 (after launch)
- **Status:** **Approved** (2026-09-30, with the decisions in section 13)
- **Related ADRs:** 0007 (external data behind an anti-corruption layer), 0015 (new, proposed:
  Wizards Play Network as a source of product imagery), 0014 (pricing sources)

## 1. Purpose & scope

Show Wizards' **official product photos** (packs, displays, bundles, Commander decks, prerelease
packs) in the store and inventory, and each set's **official key art** as its banner, instead of
the generated packaging art. Also add the **Fan Content Policy notice** the site needs anyway.

**Why this source.** Wizards Play Network (WPN, `wpn.wizards.com`) is Wizards' official site for
game stores. Every set has a public product page with a photo of each product (transparent PNGs)
and the set's key art. No login is needed. Wizards' Fan Content Policy allows free fan content to
use Wizards' "pictures, artwork, graphics", and says a login for a private group doesn't break
the "free" condition. No retailer images (Amazon and similar) are used.

**Out of scope:** photos for products WPN doesn't show (cases, displays of Commander decks, most
"Set of N" bundles, welcome decks). They keep the generated art. Card images are unchanged
(Scryfall).

## 2. Ubiquitous language

| Term              | Meaning in this codebase                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| **WPN page**      | A set's product page: `https://wpn.wizards.com/en/products/<page slug>`                           |
| **Page slug**     | The last part of that address, e.g. `secrets-of-strixhaven`                                       |
| **WPN product**   | One product on a WPN page: its name as WPN writes it ("Play Booster Display") and its photo's URL |
| **Key art**       | The set's official marketing illustration: the WPN page's header image                            |
| **Product photo** | The WPN photo chosen for one of our sealed products                                               |
| **Match**         | How a product got its photo: `by name`, `by kind`, `chosen by an admin`, or `none`                |

## 3. Domain model

```ts
/** What a WPN page offers, after the gateway has parsed and validated it. */
type WpnSetPage = Readonly<{
  slug: string;
  keyArtUrl: string | null; // images.ctfassets.net URL, without size parameters
  products: ReadonlyArray<{ name: string; imageUrl: string }>;
}>;

type PhotoMatch = "by_name" | "by_kind" | "admin" | "none";

/** The photo decided for one sealed product. */
type ProductPhoto = Readonly<{
  productId: SealedProductId;
  wpnName: string | null; // which WPN product it came from; null when match = "none"
  imageUrl: string | null;
  match: PhotoMatch;
}>;
```

**Matching** is a pure function, `matchPhotos(page, products): ProductPhoto[]`:

1. **By name first.** A WPN product whose name, minus the set name and punctuation, is contained
   in one of our product names matches that product: "Scene Box – Camp Comrades" ↔ "Final Fantasy
   Scene Box Camp Comrades", "Nightmare Bundle" ↔ "Duskmourn Nightmare Bundle", "Codex Bundle",
   "Draft Night", "Chocobo Bundle".
2. **Then by kind**, with a table from WPN's standard names to MTGJSON's product kinds. From all 19
   of our sets' pages (checked 2026-09-30), these names cover nearly everything:

   | WPN name                          | Our kind (MTGJSON `category/subtype`)                       |
   | --------------------------------- | ----------------------------------------------------------- |
   | Play Booster / Display            | `booster_pack/play` / `booster_box/play`                    |
   | Collector Booster / Display       | `booster_pack/collector` / `booster_box/collector`          |
   | Draft Booster / Display           | `booster_pack/draft` / `booster_box/draft`                  |
   | Set Booster / Display             | `booster_pack/set` / `booster_box/set`                      |
   | Jumpstart Booster / Display       | `booster_pack/jumpstart` / `booster_box/jumpstart`          |
   | Bundle                            | `bundle/default`                                            |
   | Gift Bundle, Bundle: Gift Edition | `bundle/gift_bundle`                                        |
   | Prerelease Pack                   | `limited_aid_tool/prerelease_kit`                           |
   | Commander Decks                   | `deck/commander` (the set's own and its Commander set's)    |
   | Starter Kit                       | `multiple_decks/two_player_starter`, `box_set/starter_deck` |
   | 60-Card Theme Decks               | `deck/theme`                                                |

3. Otherwise **none**: the generated art stays.

## 4. Invariants

1. **Only official Wizards imagery.** Photos come only from WPN pages, and images only from
   Wizards' own image host (`images.ctfassets.net/0piqveu8x9oj/…`, the WPN space). Any other URL
   is rejected by the gateway.
2. **Never altered.** Photos and key art are shown whole: no cropping, recoloring or overlays, so
   logos and legal lines printed on packaging stay intact (Fan Content Policy: don't remove
   logos that are part of Wizards' IP).
3. **Polite.** At most one WPN page request per second, with our `User-Agent`. A set's page is
   read when the set is first imported, then on the nightly run only while the set is settling
   (catalog rule 12) or its page was missing, and on a full run. Images download **once each**,
   at the size we show them, on first view, then are served from disk (like card images).
4. **Never a broken store.** A missing page, a page that changed shape, or a failed download
   means generated art, never an error. The admin page lists what has no photo and why.
5. **An admin's choice wins.** A photo an admin picked (or "no photo") is kept by every later
   sync until the admin changes it.
6. **No private credentials.** WPN pages embed an access token for Wizards' content service.
   We never use it: we read the public page, as a browser does.
7. **The Fan Content Policy notice** is on every page.

## 5. Use cases

| Use case                 | Actor / authz    | Input                          | Output                       | Errors (`kind`)                         | Transaction? |
| ------------------------ | ---------------- | ------------------------------ | ---------------------------- | --------------------------------------- | ------------ |
| Refresh a set's photos   | worker (sync)    | set code                       | photos saved; summary counts | page not found / changed shape (logged) | one per set  |
| Set a set's page slug    | admin            | set code, slug (or automatic)  | slug saved; set re-read      | `Forbidden`, `SlugInvalid`              | yes          |
| Choose a product's photo | admin            | product id, WPN name or "none" | photo saved as `admin`       | `Forbidden`, `PhotoNotOnPage`           | yes          |
| Serve a product photo    | anyone signed in | product id, size               | image bytes (cached)         | 404 when it has none                    | no           |
| Serve a set's key art    | anyone signed in | set code, size                 | image bytes (cached)         | 404 when it has none                    | no           |

**Finding a set's page:** try the slug made from the set's name (`Secrets of Strixhaven` →
`secrets-of-strixhaven`), then with `magic-the-gathering-` in front. Checked on all 20 of our main
sets: 17 resolve the first way, Foundations and Avatar: The Last Airbender the second, and The
Big Score (a bonus sheet with no products) has no page, correctly. An admin can type a slug for
any set that needs one.

## 6. Ports

```ts
/** WPN, parsed and validated by the anti-corruption layer. */
interface WpnGateway {
  /** The set's page, or null when there's no page at that slug (a 404). */
  setPage(slug: string): Promise<WpnSetPage | null>;
}
// Adapters: httpWpnGateway (polite fetch, 1 request/second) and fixtureWpnGateway (tests).

/** The existing ImageStore gets a second key kind for product photos and key art. */
type ArtworkKey = Readonly<{ kind: "product" | "keyArt"; id: string; size: "card" | "banner" }>;
```

The gateway finds products in the page's product selector (each item: a photo URL and a name) and
the key art in its header block, then validates with Zod: at least a name and an allowed image
URL per product. It asks Wizards' image host for the size we show (`?w=600&fm=webp` for products,
`?w=1600&fm=webp` for key art) rather than the full-size PNG.

## 7. State machines

None.

## 8. Persistence

New tables in the catalog module (migration `0016_product_photos`):

- `set_artwork`: `set_code` (PK, FK `card_sets`), `page_slug` (null = not found), `slug_override`
  (admin), `key_art_url`, `checked_at`, `status` (`found` | `no_page` | `changed_shape`).
- `wpn_products`: (`set_code`, `name`) PK, `image_url`. What the page offered, for the admin's
  picker.
- `product_photos`: `product_id` (PK, FK `sealed_products`), `wpn_name`, `image_url`, `match`
  (`by_name` | `by_kind` | `admin` | `none`).

Downloaded images live next to card images in `IMAGE_CACHE_DIR` (`products/`, `key-art/`), so the
existing Docker volume and backups cover them.

## 9. Read models (queries)

- The store's product lists and the inventory get `photoUrl: string | null` per product.
- The store's set list and set page get `keyArtUrl: string | null`.
- **Admin → Catalog → Photos:** per set, its page (link), status, and each product's photo with how
  it matched. Products without a photo are listed first, with a picker of that set's WPN photos.

## 10. Events emitted

None.

## 11. Patterns applied

- **Anti-corruption layer** (ADR 0007): HTML never leaves `catalog/infrastructure`; the domain sees
  `WpnSetPage`.
- **Pure core:** `matchPhotos` and `slugCandidates` are pure and unit-tested.
- **Strategy table** for kind matching, as for pack sheets.
- **Cache-aside** for images, as for card images.
- The screens keep `ProductArt` (generated) as the fallback component.

## 12. Test plan

- **Domain unit tests:** `slugCandidates` (colons, apostrophes, trademarks like "FINAL FANTASY™");
  `matchPhotos` on all 19 real pages' product names against our real product names (as a fixture:
  names only), including the by-name cases and "no photo" cases; admin choices survive.
- **Gateway tests** on **recorded, trimmed WPN pages** in `tests/fixtures/wpn/` (Secrets of
  Strixhaven, Final Fantasy with its 16 products, and one page with the header missing), plus a
  page with a foreign image host (rejected). No network.
- **Integration test:** a fixture sync fills the three tables; a second sync keeps admin choices.
- **Browser test:** the store shows a product's photo `<img>` (served from a local test image) and
  falls back to generated art for a product without one.
- **Remote test** (opt-in `pnpm test:remote`): one live WPN page still parses.

## 13. Decisions from review (2026-09-30)

1. **Commander decks keep their generated art featuring their own commander.** WPN's per-deck box
   photos aren't labeled (numbered 01–05), so they're offered in the admin picker instead.
2. **Cases keep generated art** (a case isn't what the display photo shows). Cases, "Set of N"
   bundles and displays of decks are never matched.
3. **Key art on the store's set tiles** as well as each set's banner.
4. **Everything is downloaded at sync time and kept** (not on first view), since it's small: two
   sizes per photo (about 50 MB in all for our 19 sets, against 236 MB at full size).
5. **Also kept from WPN** (a survey of all 19 pages: 190 products):
   - **Official MSRP** (79 products, mostly 2025 onward) becomes the product's price. An admin's
     own price still wins; a product without one keeps its kind's price. (Examples: Final Fantasy
     Play Booster $6.99 not $5.49, Collector $37.99 not $24.99; Secrets of Strixhaven Draft Night
     $89.99 not $149.99; Final Fantasy Scene Boxes $41.99, previously not for sale.)
   - **"What's inside":** each product's description and contents (card counts, rarity odds,
     which cards it can contain), stored and shown as **plain text** (never WPN's HTML).
   - **All photo variants:** e.g. three Play Booster pack arts; each unopened pack in an inventory
     shows one, chosen by the item, so it doesn't change between visits.
   - **Release dates:** "Releases Oct 2" on products not out yet.
   - Not kept: UPC, SKU, sizes and weights, marketing zips, set logos (the policy forbids using
     logos on their own), social media art.
6. **Data comes from the page's embedded data** (`__NUXT_DATA__`: one JSON record per product,
   with name, images, MSRP, contents and release date), not from its HTML layout, which has
   generated class names. Only the key art is read from the page's header block.

## 14. Pricing precedence (changes ADR 0014)

A sealed product's price is the first of: **an admin's own price**, **WPN's official MSRP**, **its
kind's price**. None of them means not for sale, as before. The admin store page shows all three.

## 15. Implementation notes (what changed while building)

- **Matching was tuned on all 19 real pages** against our real products (a one-off check, not a
  test). It found four problems, each now a rule in `matchWpnProducts`:
  1. Cases hide under other categories ("Scene Box Case" is a `box_set`, "Collector Booster Box
     Master Case" a `booster_box`): products **named** "case" or "set of" never match.
  2. A generic name claimed a specific product ("Bundle" took the "Pizza Bundle"): specific names
     match first, standard names second.
  3. "Collector Booster" also matched each set's "… Minimal Packaging" version, so neither got a
     photo: when one of several matches is **plainly** the product (the WPN name, or it plus
     "pack"/"box"), it gets the photo.
  4. "Commander Decks Collector's Edition" didn't match "Commander Deck Wakanda Forever
     Collector's Edition" (words apart): names match when every WPN word appears, in any order,
     and our product adds no **product-type word** (so "Nightmare Bundle" ≠ "Nightmare Bundle
     Booster").
     Result on real data: 234 links, 144 with a photo, 262 images, 0 download failures.
- **A pricing bug found on the way:** cases filed under a single product's kind (Master Cases,
  Beginner Box Cases) sold at that kind's price: 24 Collector Booster Boxes for $269.99. Cases
  now never take their kind's price (`kindPriceApplies`, mirrored in SQL as `IS_CASE`).
- **Admin undo is cheap:** undoing a choice marks that one set's page to be read again and queues
  a prices sync, instead of a full sync.
- **Browser tests use their own image folder** (`.dev/e2e-images`), so their placeholder photos
  can never overwrite the real ones in the development cache.
- **Commander decks' generated art now features their own commander** (it showed the set's
  most valuable card before), from the deck list's commander.
- The data's product order differs slightly from the page's visual order; nothing depends on it.
