# 0014. Price singles at market value and sealed product at MSRP

- **Status:** Accepted (decided by the user, 2026-09-27)
- **Date:** 2026-09-27

## Context

The store sells two very different things. **Singles** have a well-known market price per printing
and finish (Scryfall's daily USD prices from TCGplayer). **Sealed product** (packs, boxes, bundles,
decks) has market prices that swing with hype and scarcity. Using those would make buying boosters
feel like playing the secondary market, which isn't the goal. MTGJSON publishes card prices but
**no** sealed-product prices (checked 2026-09-27: its daily price file has no entries for sealed
product ids).

## Decision

- **Singles** are bought and sold at **market price**: the latest daily snapshot of Scryfall's
  `usd` / `usd_foil` / `usd_etched` for that printing and finish (ADR 0013). A printing with no
  price for a finish can't be bought in that finish.
- **Sealed product** is sold at **MSRP** (manufacturer's suggested retail price), never market
  price:
  - an admin-editable table of MSRPs **per kind of product** (MTGJSON's `category` + `subtype`,
    e.g. `booster_pack/play`, `booster_box/collector`, `bundle/default`), seeded with typical US
    prices;
  - an optional **per-product override** for exceptions;
  - a product with no applicable MSRP isn't for sale until an admin sets one.
  - **Amended 2026-09-30 (ADR 0015, design doc 13):** between the two, **Wizards' official MSRP**
    from its Wizards Play Network product page, where it lists one. The order is: the product's
    own override, then the official MSRP, then its kind's price.
- Selling back (Phase 7) applies to **singles only**, at a buylist percentage of market price
  (`Cents.applyRate`, rounding down).

## Consequences

- ✅ Pack prices stay stable and fair; the constraint comes from the budget, not speculation.
- ✅ No second price source to integrate, since MSRPs are few and change rarely.
- ❌ MSRPs must be maintained by hand when new product types appear. The admin page lists
  products without a price so they're easy to spot.
- Designed in Phase 6 (store). The catalog (Phase 4) only imports product kinds so they can be
  priced.

## Alternatives considered

- **Market price for sealed product:** volatile, and no free source exists.
- **MSRP computed from contents** (e.g. box = 36 × pack): real MSRPs don't follow that rule
  (boxes are discounted, bundles include extras).
