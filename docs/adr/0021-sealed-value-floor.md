# 0021. Never sell sealed product for less than its contents sell back for

- **Status:** Accepted (decided by the user, 2026-11-07); amended by
  [0024](0024-msrp-pricing-by-default.md): by default an official MSRP is no longer raised
- **Date:** 2026-11-07

## Context

ADR 0014 prices sealed product at MSRP and never at market price, so buying boosters doesn't
feel like the secondary market. The MSRP falls back to a generic price per kind of product
($3.99 for a default booster). Old sets are worth far more than that: an Alpha pack's cards
average $1,276, and the store buys cards back at 50%. 110 of 316 priced pack types in enabled
sets return more when sold back than they cost (design doc 27, section 1), which makes money
from nothing and breaks the economy for everyone in the playgroup.

## Decision

- A sealed product's price is **at least its resale value**: the average market value of its
  contents (worked out exactly from the booster recipes, deck lists and card prices) times the
  buylist rate, rounded up to the cent.
- The floor applies to **kind prices and official MSRPs**. An admin's per-product override is
  used as typed.
- Contents values are **precomputed** after each price sync and stored with the price day they
  used. A kind-priced product isn't for sale until it has been valued.
- ADR 0014's rule otherwise stands: a product's price is never its own market price, and it
  only moves when its MSRP or the floor does.

## Consequences

- ✅ Buying sealed product and selling the contents back never pays on average, whatever sets
  are enabled and whatever the buylist rate is.
- ✅ Old and high-value sets (masters, Modern Horizons, the 1990s) can be enabled safely.
- ❌ Some prices now follow the market nightly: a floored product's price changes with its
  cards' prices.
- ❌ One more nightly step and table; every sealed price must read it (one shared SQL fragment
  and one function, tested to agree).

## Alternatives considered

- **Take such products off sale:** safe, but old sets' packs could never be opened.
- **Floor at the full contents value:** also safe, but raises 256 of 316 pack types instead of
  110, so many ordinary packs would no longer cost their MSRP.
- **Admins set overrides by hand:** hundreds of products, and wrong again whenever prices move.
- **A cutoff year for sealed product:** blunt, and misses expensive recent products (collector
  boosters, Universes Beyond).
