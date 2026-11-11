# Design: MSRP pricing by default, value-based pricing as an admin switch

- **Phase:** 33 (tududi task 119)
- **Status:** **Approved** (2026-11-10, with both proposals in section 13)
- **Related:** ADR 0014 (sealed product at MSRP), ADR 0015 (official MSRPs), design doc 27 and
  ADR 0021 (the value floor, amended here by ADR 0024), design doc 06 (store)
- **Lesson:** no (a setting, a migration and a changed pure function)

## 1. Purpose & scope

Design doc 27 raises a sealed product's price to what its contents sell back for whenever that's
more than its list price. That fixed old sets priced by a generic guess (an Alpha pack at the
$3.99 default holds about $1,276 of cards), but it also lifts products **above Wizards' own
MSRP**. You'd rather a product with an MSRP sell at that MSRP, unless an admin chooses otherwise.

This phase:

1. **By default ("MSRP pricing"):** an admin's override is used as typed; a product with
   **Wizards' official MSRP sells at exactly that**; a product with **neither** takes its kind's
   price (`booster_pack/default` is $3.99), raised to its resale value when its contents are worth
   more. The contents' value only fills in what a generic guess gets wrong.
2. **An admin switch, "Value-based pricing":** turns doc 27's full rule back on, so official
   MSRPs are raised too.

**Out of scope:** reviewing the kind prices themselves (Admin → Store already edits them), lowering
a kind price when the contents are worth less (244 kind-priced products hold less than their price
in cards; that's a normal gamble, as with real boosters), and per-set switches.

### What changes, on the local catalog (2026-11-10)

| Products for sale                                    | Count |
| ---------------------------------------------------- | ----- |
| Raised above an **official MSRP** (changes to MSRP)  | 10    |
| Raised above a **kind price** (stay raised)          | 473   |
| ... of which the cards sell back for > 2× the price  | 108   |
| ... of which the cards sell back for > 10× the price | 19    |

The 10 are recent products: Final Fantasy (Collector Booster $37.99 → was $40.93; Chocobo Bundle
$109.99 → was $174.62; Gift Bundle; two Scene Boxes), three Tarkir Dragonstorm Commander decks
($44.99 → up to $60.95) and two Foundations Commander decks ($29.99 → up to $35.09).

## 2. Ubiquitous language

| Term                | Meaning in this codebase                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Pricing mode        | The store's setting: `msrp` (the default) or `value`.                                                     |
| MSRP pricing        | Overrides as typed, official MSRPs as published, kind prices raised to the resale floor.                  |
| Value-based pricing | Design doc 27's rule: official MSRPs and kind prices both raised to the resale floor; overrides as typed. |
| Resale floor        | Unchanged from doc 27: the contents value × the buylist rate, rounded up.                                 |

## 3. Domain model

```ts
// store/domain/pricing.ts
export const PRICING_MODES = ["msrp", "value"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

type PriceInputs = Readonly<{
  override: Cents | null;
  officialMsrp: Cents | null;
  kindPrice: Cents | null;
  contentsValue: Cents | null;
  buylistRateBps: number;
  pricingMode: PricingMode; // new
}>;

/** null: not for sale. */
function storePrice(inputs: PriceInputs): StorePrice | null;
```

| Price source    | `msrp` (default)           | `value`                    |
| --------------- | -------------------------- | -------------------------- |
| Admin override  | as typed                   | as typed                   |
| Official MSRP   | **as published**           | raised to the resale floor |
| Kind price only | raised to the resale floor | raised to the resale floor |
| No price        | not for sale               | not for sale               |

A kind-priced product still isn't for sale until it has been valued (doc 27, decision 3).

## 4. Invariants

1. In `msrp` mode, a product with an official MSRP and no override sells at exactly that MSRP.
2. In both modes, a kind-priced product never sells below its resale floor (doc 27's invariant 1
   now holds for kind prices always, and for official MSRPs only in `value` mode).
3. `value` mode gives exactly today's prices (doc 27's tests run in that mode).
4. Every place that shows or charges a sealed price follows the mode: store pages, buying, the
   Pack lab, Admin → Store, a draft's entry fee. The SQL fragment and `storePrice` still agree,
   checked by the existing integration test, now in both modes.
5. Changing the mode takes effect at once (prices are worked out when read; valuations don't
   change).

## 5. Use cases

| Use case               | Actor / authz | Input         | Output | Errors (`kind`) | Transaction? |
| ---------------------- | ------------- | ------------- | ------ | --------------- | ------------ |
| `setPricingMode` (new) | admin         | `PricingMode` | —      | NotAllowed      | yes          |
| `buySealed`            | player        | as now        | as now | as now          | as now       |

## 6. Ports

`StoreSettings` gains `pricingMode(): Promise<PricingMode>` and
`setPricingMode(mode, by, at)`, beside `buylistRate`.

## 8. Persistence

Migration: `store_settings` gains `pricing_mode text not null default 'msrp'`, checked to be
`'msrp'` or `'value'`. **Deploying it switches the server to MSRP pricing at once**, which is the
point. An admin can switch back on Admin → Store.

## 9. Read models (queries)

- **The store price SQL fragment** gains one condition: the floor applies to an official MSRP only
  when `ss.pricing_mode = 'value'`.
- **Admin → Store:** a "Pricing" choice beside the buylist rate, with what each does in a
  sentence, and the count of products each mode raises.
- **Store pages:** unchanged. Raised products still show "Priced at what its contents sell back
  for" with the list price struck through; in `msrp` mode that's only kind-priced products.

## 12. Test plan

- **Domain:** `storePrice` table tests for each row of section 3 in both modes; doc 27's property
  tests run in `value` mode, plus "in `msrp` mode an official MSRP is never changed".
- **Use case (fakes):** `setPricingMode` is admin-only.
- **Integration:** the SQL and `storePrice` agree on every fixture product in both modes; buying
  a product with an official MSRP charges the MSRP in `msrp` mode and the floor in `value` mode
  (the fixture's Bloomburrow Play Booster: MSRP $5.49, floor $7.24).
- **E2E:** the journey that buys the raised Bloomburrow pack sets `value` mode in its setup, or
  expects $5.49; to be decided when updating it.

## 13. Decisions (approved 2026-11-10: both proposals)

1. **What MSRP pricing gives back:** in `msrp` mode, buying one of the 10 products above and
   selling its cards back returns more than it cost, on average ($0.46 to $64.63 each, e.g. the Chocobo
   Bundle: $109.99 in, about $174 back). **Proposal: accept it** as the cost of honest MSRPs;
   an admin who sees it abused turns on value-based pricing. Alternative: in `msrp` mode, raise an
   official MSRP only when the contents sell back for more than twice it (none of the 10 today).
2. **The default for an existing server:** **proposal: `msrp`**, as you asked; the migration sets
   it. Alternative: keep `value` on servers that exist and use `msrp` only for new ones.

## 14. Implementation notes (2026-11-10)

- `PricingMode` and the changed `storePrice` are in `store/domain/pricing.ts`; the SQL fragment
  (`MSRP` in `store/queries/store.ts`) gained one line for official MSRPs in `msrp` mode.
  `setPricingMode` is admin-only and returns `Forbidden` otherwise, like `setBuylistRate`
  (the doc said `NotAllowed`).
- Migration `0034_pricing_mode.sql`. The integration test that checks SQL against `storePrice`
  now runs in both modes, with the fixture's Bloomburrow Play Booster given a $5.99 official
  MSRP so the modes differ.
- Admin → Store has a "Pricing sealed product" choice and says how many products the modes
  disagree on (10 on the local catalog).
- Checked in a browser at phone width in dark mode: the Final Fantasy Collector Booster sells at
  $37.99 in MSRP pricing and $40.93 (with $37.99 struck through) in value-based pricing.
- The e2e journey needs no change: it buys a kind-priced pack, raised in both modes.
