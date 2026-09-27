# Design: Store & inventory

- **Phase:** 6
- **Status:** **Approved** (self-approved during the unattended run, 2026-09-27; see
  [decisions-to-review.md](../decisions-to-review.md))
- **Related ADRs:** 0004 (ledger), 0005 (unit of work), 0008 (seeded randomness), 0011
  (printing × finish), 0013 (store ledger), 0014 (MSRP)

## 1. Purpose & scope

Players **buy sealed product at MSRP**, keep it **unopened in an inventory**, and **open** it:
boxes and bundles unpack into their packs and extras, packs open into cards (Phase 5's engine),
and decks give their cards. Opened cards land in the player's **collection**.

Three modules, following the dependency graph in the architecture overview:

- **`inventory`**: owned sealed items, their lifecycle (unopened → opened), unpacking and opening.
- **`collection`**: owned cards at printing × finish (ADR 0011), and the acquisitions log. This
  phase builds the write side and a basic list. Phase 7 adds browsing, filters and selling.
- **`store`**: the MSRP price list, buying sealed product, and the store transaction ledger
  (ADR 0013). It orchestrates wallet + inventory in one transaction.

Also in this phase: **generated product art**, and the Pack lab showing a pack's MSRP.

**Out of scope:** buying and selling singles (Phase 7), the animated opening (Phase 8), trading
sealed product (not planned), the activity feed (Phase 11).

## 2. Vocabulary

| Term             | Meaning                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Product**      | A catalog sealed product (MTGJSON `sealedProduct`): a pack, box, bundle, deck, kit…                                             |
| **Product kind** | A product's `category/subtype`, e.g. `booster_box/play`. MSRPs are set per kind.                                                |
| **MSRP**         | The price the store sells a product for (ADR 0014): the kind's price, unless the product has its own override.                  |
| **Item**         | One thing a player owns that hasn't been fully used: a **product** (to unpack), a **pack** (to open) or a **deck** (to open).   |
| **Unpack**       | Opening a product one level: its packs, decks and nested products become new items, its loose cards go to the collection.       |
| **Open**         | Opening a pack (cards from the pack engine) or a deck (its deck list's cards).                                                  |
| **Open all**     | Unpack or open an item, then keep opening everything that came out of it, in one go.                                            |
| **Extras**       | Physical things in a product we don't model (spindown, storage box, reference cards). Listed on the item, no effect.            |
| **Acquisition**  | One entry in the collection's log: which cards were gained or lost, from where (a pack, a deck, a product, the store, a trade). |

## 3. Domain model

```ts
// inventory/domain
type ItemContent =
  | { kind: "product"; productId: SealedProductId }
  | { kind: "pack"; setCode: SetCode; boosterType: string }
  | { kind: "deck"; setCode: SetCode; deckName: string };

type Item = {
  id: ItemId; // branded bigint id
  ownerId: UserId;
  content: ItemContent;
  name: string; // "Bloomburrow Play Booster Pack", kept so the name never changes later
  productId: SealedProductId | null; // which product it was bought or unpacked as, for its art
  parentId: ItemId | null; // the box it came out of
  status: "unopened" | "opened";
  acquiredAt: Date;
  openedAt: Date | null;
};

/** What unpacking one product produces (one level of the product tree). */
type UnpackPlan = {
  items: NewItem[]; // packs, decks and nested products
  cards: CardGain[]; // loose cards (a bundle's promo card)
  extras: string[]; // "Bloomburrow Spindown"
};
```

**Collapsing:** a product whose contents are **exactly one pack** (every `booster_pack`
product) becomes a **pack item** straight away, so buying a pack gives you a pack to open, not
a box with a pack inside. Every other product becomes a product item.

**Unpacking is a pure function** (the Composite pattern):
`unpack(contents, rng) → UnpackPlan`. `pack` → a pack item. `sealed ×n` → n items (collapsed as
above). `deck` → a deck item. `card` → a card gain. `other` → an extra. `variable` → pick one
option at random (`randomInt`), then unpack that option. The seed is stored with the item.

```ts
// collection/domain
type CardGain = { printingId: PrintingId; finish: Finish; quantity: number };
type AcquisitionSource = "pack" | "deck" | "product" | "store" | "trade";

// store/domain
type ProductKind = string; // "booster_box/play"
type MsrpTable = ReadonlyMap<ProductKind, Cents>;
function msrpFor(product, table, overrides): Cents | null; // override, else kind price, else null
```

## 4. Rules (invariants)

1. **A sealed product costs its MSRP:** its own override if it has one, otherwise its kind's
   price. A product with neither is **not for sale**.
2. **Only products from enabled sets** are for sale, and only if they can be fully opened:
   every pack inside has a booster recipe, and every deck inside has a deck list. (Catalog rule 5
   already guarantees this for stored products. The store checks again.)
3. **Buying is one transaction:** the wallet is debited (`purchase_sealed`), a store transaction
   is written, and the items are created. It all happens, or none of it does. A player can't
   spend more than their balance (wallet rule 3).
4. **Quantity** per purchase is 1–24 (so a mistyped 1000 doesn't empty a wallet).
5. **Items only move forward:** `unopened → opened`. Opening an opened item, or someone else's
   item, is refused. The item row is locked while it's opened, so a double-click can't open a pack
   twice.
6. **Every opening is replayable and recorded:** a pack opening stores its seed **and** its cards;
   a product unpacking stores its seed, extras and the items it created.
7. **Every card gained is logged:** the collection's quantities always equal the sum of its
   acquisitions log.
8. **MSRPs are edited by admins only**, whole cents, $0.01–$10,000. Clearing one takes the kind
   off sale again.

## 5. Use cases

| Use case          | Who    | Input                    | Output                             | Errors (`kind`)                                                          | Transaction |
| ----------------- | ------ | ------------------------ | ---------------------------------- | ------------------------------------------------------------------------ | ----------- |
| `buySealed`       | player | productId, quantity      | the new items                      | `ProductNotForSale`, `QuantityInvalid`, `InsufficientFunds`              | yes         |
| `openItem`        | player | itemId                   | `Opening` (pack / deck / unpacked) | `ItemNotFound`, `AlreadyOpened`, `BoosterUnavailable`, `DeckUnavailable` | yes         |
| `openAll`         | player | itemId                   | every `Opening`, in order          | same as `openItem`                                                       | yes         |
| `setKindPrice`    | admin  | kind, cents or null      | —                                  | `Forbidden`, `PriceInvalid`                                              | yes         |
| `setProductPrice` | admin  | productId, cents or null | —                                  | `Forbidden`, `PriceInvalid`, `ProductNotFound`                           | yes         |

## 6. Ports

```ts
// inventory
interface ItemRepository { add(items): Promise<Item[]>; lock(id): Promise<Item | null>; markOpened(id, at, opening) }
interface ProductCatalog { product(id): Promise<SealedProduct | null>; deckCards(setCode, name): Promise<CardGain[] | null> }
// collection
interface CollectionRepository { receive(userId, gains, source, ref, at): Promise<void> }
// store
interface PriceList { msrpTable(): Promise<MsrpTable>; override(productId): Promise<Cents | null>; setKindPrice(...); setOverride(...) }
interface StoreLedger { recordSealedPurchase(...): Promise<number> } // returns the transaction id
// wallet (new, used by the store in the same transaction)
function spend(services, { userId, amount, kind, ref, now }): Promise<Result<void, InsufficientFunds>>
```

Adapters read the catalog's tables directly (like the pack engine's `BoosterSource`) and re-check
stored JSON with Zod.

## 7. State machines

Item: `unopened --open--> opened` (terminal). A pure `openTransition(item, actor, now)` returns
`err` for `AlreadyOpened` or `ItemNotFound` (someone else's item looks exactly like a missing one).

## 8. Persistence

- **Wallet:** `ledger_entries` gains `ref text` (e.g. `store:42`). The kind check allows
  `purchase_sealed`, `purchase_single` (Phase 7) and `sellback` (Phase 7). The direction check
  becomes: `correction`, `purchase_sealed` and `purchase_single` are negative, and every other
  kind is positive.
- **Collection:** `collection_cards(user_id, printing_id, finish, quantity > 0)`, primary key
  `(user_id, printing_id, finish)`. `acquisitions(id, user_id, printing_id, finish, quantity ≠ 0,
source, ref, created_at)`.
- **Inventory:** `sealed_items(id bigserial, owner_id, content_kind, product_id, set_code,
booster_type, deck_name, name, parent_id, status, acquired_at, acquired_from, opened_at)`, with
  a check that exactly the right columns are filled for each kind. `item_openings(item_id PK,
seed, result jsonb)`: the pack's cards, or the unpacking's extras and child ids.
- **Store:** `msrp_prices(kind PK, cents)`, seeded with typical US prices;
  `msrp_overrides(product_id PK, cents)`; `store_transactions` per ADR 0013, generalized to
  sealed product: `item_kind ('sealed' | 'single')`, `product_id` or `printing_id + finish`,
  `quantity`, `unit_market_cents` (the MSRP for sealed), `rate_bps`, `unit_price_cents`,
  `total_cents`, `price_day`, `created_at`.

## 9. Read models

- `storeSets(db)`: enabled sets with at least one product for sale.
- `productsForSale(db, setCode)`: products with MSRP, kind label and a featured printing for
  the art.
- `inventoryFor(db, userId)`: unopened items grouped by name, plus the latest openings.
- `openingFor(db, userId, itemId)`: one opened item's result.
- `msrpAdmin(db)`: every product kind in enabled sets with its price and product count, and
  products with no price.
- `collectionFor(db, userId)`: owned cards (basic, extended in Phase 7).

## 10. Screens

| Route             | Purpose                                                                               |
| ----------------- | ------------------------------------------------------------------------------------- |
| `/store`          | sets you can buy from, with generated set art                                         |
| `/store/[code]`   | that set's products: art, name, MSRP, **Buy** (with quantity)                         |
| `/inventory`      | unopened items (grouped, with counts), **Open** / **Open all**, recent openings       |
| `/inventory/[id]` | what an opening produced: a pack's cards in reveal order, or what a box unpacked into |
| `/collection`     | owned cards (basic grid; Phase 7 adds filters and selling)                            |
| `/admin/store`    | MSRP per product kind, per-product overrides, and products with no price              |

**Generated product art** (`src/ui/product-art.tsx`): a package drawn with HTML and CSS in the
set's own colors (a hue derived from the set code). The shape depends on the product (tall
crimped pack, wide box, square bundle, deck box). It shows the Keyrune set symbol, set name,
product label, and a window showing the art of the set's most valuable card, cropped from its
card image (so no new image type is fetched), credited to the artist.

## 11. Patterns applied

- **Composite (12):** one recursive-shaped `unpack` handles every product tree.
- **State machine (13):** the item lifecycle.
- **Unit of work (5):** buying spans wallet, store and inventory. Opening spans inventory, packs
  and collection. Each module exposes a function that runs **inside the caller's transaction**
  (`spend`, `receiveItems`, `receiveCards`), like the wallet's `bringUpToDate`.
- **Append-only ledgers (15):** the wallet ledger, the store transactions and the acquisitions log.
- **Injected nondeterminism (17):** seeds for packs and for "variable" product contents.

## 12. Test plan

- **Domain:** `unpack` for every content kind, including nested and variable contents, with
  collapsing; `msrpFor` precedence; the item transition table.
- **Use cases (fakes):** buying (not for sale, bad quantity, not enough money, success writes all
  three records), opening each item kind, double opening, someone else's item, open all on a box.
- **Integration:** migrations and constraints; repositories; buying and opening against real
  Postgres with the fixture catalog, including a rollback when the wallet can't pay; two
  concurrent openings of one pack (one wins).
- **End-to-end:** a player buys a Bloomburrow play booster, opens it, and sees its cards in the
  opening and in their collection. The balance drops by the MSRP.

## 13. Decisions made without review (see decisions-to-review.md)

1. Case products (`booster_case`, `bundle_case`, …) have **no default MSRP**, so they're not for
   sale until an admin prices them. Most playgroups won't buy six boxes at once.
2. Welcome decks and promotional or sample packs have no default price. They're free in stores.
3. Store transactions cover sealed product too (a small generalization of ADR 0013).
4. Product art is HTML/CSS rather than SVG, so it can use the Keyrune font and cached card
   images directly.
5. Products are sold only from **enabled** sets. Enabling a set is what puts it in the store.
