# Design: a value floor for sealed product

- **Phase:** 27
- **Status:** **Built** (2026-11-07). Approved the same day with every recommendation, and
  your framing of the trigger: contents worth more than twice the price (the buylist rate,
  50%). Implementation notes in section 14
- **Related:** ADR 0014 (sealed product at MSRP; this amends it, see ADR 0021), ADR 0015
  (official MSRPs), design doc 06 (store and inventory), design doc 07 (selling singles back),
  design doc 17 (a draft's entry fee is three packs)

## 1. Purpose & scope

Sealed product sells at an MSRP: an admin's override, else Wizards' official MSRP, else a
generic price for its kind (`booster_pack/default` is $3.99). For old sets the generic price is
far below what's inside. Selling the contents back to the store at the buylist rate (50%)
returns more than the product cost, so buying and selling back is free money. A simulation of
300 openings of every priced pack type in enabled sets (2026-11-07, local catalog) found:

| Pack                     | Price  | Average contents | Sold back at 50% |
| ------------------------ | ------ | ---------------- | ---------------- |
| Alpha                    | $3.99  | $1,276.27        | $638.14          |
| Beta                     | $3.99  | $825.26          | $412.63          |
| Arabian Nights           | $3.99  | $600.71          | $300.36          |
| Mirrodin tournament pack | $12.99 | $54.76           | $27.38           |
| Kaldheim green theme     | $4.99  | $20.24           | $10.12           |

**110 of 316** priced pack types return more than they cost. The same would happen with masters
sets, which are worth enabling next (Double Masters, Modern Horizons…).

Your rule: **when a product's average contents are worth more than twice its price** (so that
selling them back at half price returns more than it cost), the price goes up. It goes up to
what the contents sell back for, so buying and reselling breaks even on average and never pays.

**Out of scope:** singles (bought at market, sold back at half: no gap to exploit), deciding
which sets to enable (an admin choice; this only makes enabling more of them safe), and pricing
sealed product at its own market price (ADR 0014 still says no).

## 2. Ubiquitous language

| Term           | Meaning in this codebase                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Contents value | The **average** market value of everything a product contains, worked out exactly from the recipes (section 3.1), not by simulation. |
| Resale value   | The contents value × the buylist rate (50% today): what selling the contents back returns, on average.                               |
| Value floor    | The lowest price a product may sell at: its resale value, rounded up to the cent.                                                    |
| List price     | The price before the floor: override, else official MSRP, else kind price (ADR 0014 and 0015).                                       |
| Store price    | What the store charges: the list price, raised to the value floor when it's below it (decision 2 says when the floor doesn't apply). |
| Valuation      | One pass that works out every listed product's contents value from the latest prices, stored with the price day it used.             |

## 3. Domain model

```ts
// packs/domain: exact average value of one pack, from its recipe and today's prices.
function expectedPackValue(config: BoosterConfig, facts: FactsLookup): number; // cents, fractional

// store/domain: a product's contents value, walking its contents tree (pure).
type ValueSources = Readonly<{
  pack(setCode: SetCode, boosterType: string): number | null; // null: no recipe
  card(printingId: PrintingId, finish: Finish): number; // 0 when unpriced
  deck(setCode: SetCode, deckName: string): number | null; // null: no list
  product(productId: SealedProductId): readonly SealedContent[] | null;
}>;

type ContentsValue = Readonly<{
  cents: Cents; // rounded down
  /** Some part couldn't be valued (a missing recipe, deck or nested product): counted as 0. */
  isPartial: boolean;
}>;

function contentsValue(contents: readonly SealedContent[], sources: ValueSources): ContentsValue;

// store/domain: the price rule.
function storePrice(input: {
  override: Cents | null;
  officialMsrp: Cents | null;
  kindPrice: Cents | null;
  contentsValue: Cents | null; // null: not valued yet
  buylistRateBps: number;
}): Readonly<{ price: Cents; isRaised: boolean }> | null; // null: not for sale
```

### 3.1 Average pack value, exactly

The Pack lab's "expected per pack" counts already come from the recipe's weights
(`expectedPerPack` in `packs/domain/odds.ts`): each variant counts in proportion to its weight,
and each sheet slot gives each card `count × weight / total weight` copies. The value uses the
same sums, with each copy's market price in the finish that sheet gives (`finishFor`):

```
value = Σ variants (variant weight / total) × Σ sheets in it  Σ cards  copies × price(card, finish)
```

It's exact for the expected value, since an average is linear, whatever the duplicate and
colour-balancing rules do to single packs. An unpriced card counts as $0, because the store
won't buy it back.

### 3.2 Contents value of a product

A walk over `SealedContent` (the same tree inventory unpacks):

| Content          | Value                                                                            |
| ---------------- | -------------------------------------------------------------------------------- |
| `pack`           | its recipe's expected value (3.1); no recipe → 0, and partial                    |
| `card`           | its market price in that finish                                                  |
| `deck`           | the sum of its cards' prices; no list → 0, and partial                           |
| `sealed` × count | count × the nested product's value (a product inside itself is a defect: throws) |
| `variable`       | the **average** of its options (opening picks one uniformly at random)           |
| `other`          | 0 (spindowns, storage boxes)                                                     |

## 4. Invariants

1. **No product's store price is below its resale value**, except under an admin override
   (decision 2). Buying a product and selling everything in it back returns, on average, no more
   than it cost.
2. The floor only ever **raises** a price, never lowers one, and never makes a product for sale
   that had no list price.
3. A product priced by its kind's price is **not for sale until it has been valued** (decision
   3). Products with an override or official MSRP keep selling at that until valued.
4. Every place that shows or charges a sealed price uses the same rule: the store pages, buying,
   the Pack lab, Admin → Store and a draft's entry fee. One SQL fragment and one TypeScript
   function, tested to agree.
5. The floor follows the buylist rate: setting it to 0% (the store stops buying) removes the
   floor; raising it raises the floor.
6. A valuation is all or nothing (one transaction) and records the price day it used.

## 5. Use cases

| Use case               | Actor / authz   | Input  | Output                               | Errors | Transaction? |
| ---------------------- | --------------- | ------ | ------------------------------------ | ------ | ------------ |
| `valueProducts`        | system (worker) | —      | `{ products, partial, priceDay }`    | —      | yes          |
| `valueProductsIfStale` | system (worker) | —      | the same, or null if already current | —      | yes          |
| `buySealed` (changed)  | player          | as now | as now, at the store price           | as now | as now       |

"Stale" means no valuation yet, or one made from an older price day than the newest one in
`price_snapshots`. The worker's schedule loop calls `valueProductsIfStale` every 30 seconds, as
it checks for queued syncs, so a valuation follows each nightly sync (and the first start after
deploying) within a minute. `pnpm worker value-products` runs it by hand.

## 6. Ports

```ts
interface ProductValuationSource {
  /** Every listed product in an enabled set, with its contents. */
  listedProducts(): Promise<SealedProduct[]>;
  /** Recipes, deck lists and latest prices for what those products contain. */
  sources(products: readonly SealedProduct[]): Promise<ValueSources>;
  newestPriceDay(): Promise<string | null>;
}
interface ProductValues {
  lastPriceDay(): Promise<string | null>;
  replaceAll(
    values: readonly { productId: SealedProductId; value: ContentsValue }[],
    priceDay: string,
  ): Promise<void>;
}
```

Both are Drizzle adapters in `store/infrastructure`, reading the catalog's tables (CQRS-lite).
The pure pack value comes from the packs module's public API (`expectedPackValue`).

## 7. State machines

None.

## 8. Persistence

One table, owned by the store. Migration `0029_product_values.sql`.

```
product_values
  product_id     text primary key references sealed_products(id) on delete cascade
  value_cents    bigint not null check (value_cents >= 0)
  is_partial     boolean not null
  price_day      date not null
  valued_at      timestamptz not null
```

The store's `MSRP` SQL fragment becomes the store price:

```sql
case
  when o.cents is not null then o.cents                        -- an admin's override wins
  when coalesce(w.msrp_cents, k.cents) is null then null        -- no list price: not for sale
  when w.msrp_cents is null and v.value_cents is null then null -- kind price, not valued yet
  else greatest(coalesce(w.msrp_cents, k.cents),
                ceil(coalesce(v.value_cents, 0) * ss.buylist_rate_bps / 10000.0))
end
```

## 9. Read models (queries)

- **Store set page and product cards:** the store price. A raised price shows a note: "Priced at
  what its contents sell back for" (with the list price struck through, decision 5).
- **Admin → Store:** each product's list price, contents value, floor and store price; partial
  values marked "some contents couldn't be valued".
- **Pack lab:** next to "Cards inside an average pack are worth $X", the store price and whether
  the floor raised it.
- **Drafts:** the entry fee (three packs) uses the store price, so an Alpha draft costs what its
  packs do.

## 10. Events emitted

None.

## 11. Patterns applied

- **Precompute with a version** (ADR 0019's idea): values are stored with the price day they
  came from, recomputed when a newer day exists.
- **Functional core:** `expectedPackValue`, `contentsValue` and `storePrice` are pure and
  property-tested; the adapters only gather rows.
- **One shared definition** (lessons 23 and 24): the SQL fragment and `storePrice` are the same
  rule, with a test that checks them against each other on the fixture catalog.
- **Composite** (design doc 06): the contents walk mirrors inventory's unpacking.

## 12. Test plan

- **Domain:** `expectedPackValue` against a hand-worked recipe, and against the Pack lab's
  simulated average (within a tolerance, many seeds); `contentsValue` for each content kind,
  nesting, variable averages, partial; `storePrice` property tests (never below the floor
  without an override, never lowers a list price, never creates a price, rate 0 means no floor).
- **Use cases (fakes):** stale vs current valuation; all-or-nothing replace.
- **Integration:** on the fixture catalog, every listed product's SQL store price equals
  `storePrice` from TypeScript; buying a raised product charges the raised price; a draft fee
  follows it; `check-packs`-style report shows no pack type whose resale value exceeds its
  price.
- **E2E:** the store page shows the "Priced at what its contents sell back for" note on a raised
  product (fixture: set a tiny kind price in test setup so Bloomburrow packs get raised).

## 13. Open questions

1. **How high to raise:** recommended **to the resale value** (contents × buylist rate), as you
   described: reselling breaks even on average, and opening is still a fair gamble. The
   alternative is the full contents value, like buying singles at market, which would raise
   256 of 316 pack types instead of 110.
2. **Which prices get the floor:** recommended **kind prices and official MSRPs**, but not an
   admin's override, so you can still deliberately sell something cheap (a promotion). The
   alternative floors overrides too.
3. **Before the first valuation:** recommended **kind-priced products aren't for sale until
   valued** (at most a minute after a sync or deploy). The alternative sells them at the kind
   price meanwhile, which leaves the gap open briefly.
4. **Partial values:** recommended **use them** (the missing parts count as $0, so the floor is
   still a true lower bound) and flag them in Admin → Store. The alternative takes such products
   off sale until fixed.
5. **Show the raise to players:** recommended **yes**, a short note and the struck-through list
   price, so a $638 Alpha pack doesn't look like a bug. The alternative shows only the price.

## 14. Implementation notes (2026-11-07)

- **Where things live.** `expectedPackValue` is in `packs/domain/odds.ts`, next to
  `expectedPerPack`, with `valueBooster(services, key)` loading a recipe and its prices.
  `contentsValue`, `resaleFloor` and `storePrice` are pure functions in `store/domain`. The
  valuation (`store.valueProducts` / `valueProductsIfStale`) gathers nested products, pack
  values, deck lists and prices through ports the store already had (`productCatalog`,
  `boosters`), plus one new one, `productValues`.
- **The SQL rule** is one fragment in `store/queries/store.ts` (`MSRP`, now the store price),
  joined to `product_values` and `store_settings`. An integration test checks that the store
  page, the admin page and `storePrice` agree on every listed product in the fixture catalog.
- **Worker:** the schedule loop calls `valueProductsIfStale` every 30 seconds. `pnpm worker
value-products` runs it by hand. Valuing all 2,193 listed products in the local catalog took
  about 15 seconds.
- **Local catalog results:** 483 of 1,525 products for sale are raised, and none is partial. An
  Alpha Booster Box goes from $143.64 to $22,526.06, and an Alpha Starter Deck from $9.99 to
  $2,401.11. Store prices can now exceed the $10,000 limit on prices admins type; spending has
  no such limit.
- **Fixture effect:** in the recorded fixture catalog a Bloomburrow Play Booster's cards sell
  back for $7.24, above its $5.49 MSRP, so tests about MSRPs turn the floor off (buylist rate
  0%), and the e2e journey now buys that pack at $7.24 and checks the note.
- **E2E setup** runs `pnpm worker value-products` against the e2e database, since test setup
  may not import the server's composition root (ADR 0009).
