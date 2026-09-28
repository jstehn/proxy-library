# Future ideas

Things we may change or add later: requests that were deferred, limits we know about, and
improvements noticed along the way. Nothing here is scheduled. When one is picked up, it gets a
design doc (or joins a phase's design) and is removed from this list.

## Pack opening

- **Special pack rules that MTGJSON's recipes can't express.** (Requested 2026-09-27.)
  Example: **Reality Fracture** play boosters reportedly guarantee _matching Echoverse pairs_.
  MTGJSON describes a pack as independent draws from weighted sheets (plus fixed sheets and
  color balance), so "these two slots must hold a matching pair" can't be written in its format.
  - **Status (2026-09-27):** MTGJSON has **no booster recipe for FRA yet** (only its two
    Commander deck products), so FRA packs can't be opened at all today. Check again after a
    full sync once MTGJSON publishes them, and read how they encode the pairs. They may use a
    fixed sheet per pair, or many variants.
  - **If the data can't express it:** add a small, per-set "booster rule" step after
    `generatePack` (e.g. `pairEchoverse(pack, rng)`), chosen from a table keyed by set and
    booster type (the same Strategy table idea as the sheet drawers). Each rule gets its own
    statistical test, and `check-packs` checks it on real data.
  - Other rules to look for in the same pass: guaranteed "one of each" slots, serialized-card
    odds printed on the box, and Jumpstart theme packs (MTGJSON uses fixed sheets for these).
- **Animated foil effects** beyond the still sheen: Phase 8 adds the animated shimmer on reveal.
  A later pass could show different foil treatments (surge, galaxy, fracture foil) differently,
  using the printing's promo types.

- **Spoiler-proof reveals:** fetch each pack's cards only when it's torn open, so they aren't in
  the page source beforehand.
- **Real sound effects** (CC0 files) to replace the generated ones, and a volume slider.

## Catalog and images

- **Real product photos** (retailer images) for sealed products and sets. **Needs a decision on
  retailer terms of use first.** Generated SVG art covers every product until then.
- **Image cache warming**: fetch a set's small images in the background after it's enabled,
  politely rate-limited, so the first visit to a set page isn't slow.
- **In-flight image de-duplication**: if two people ask for the same uncached image at once,
  fetch it once.
- **`POST /cards/collection` fallback** for printings missing from Scryfall's bulk file (not
  needed so far: the bulk file covered every English paper printing).

## Collection and store

- **Serialized cards as individual copies** with their own serial number ("#127/500"), as ADR
  0011's option (b). Today they're ordinary stacks.
- **Bulk selling:** "sell everything above 4 copies" or "sell all commons under $0.10", with a
  preview of the payout.
- **Wishlist and price alerts** from the price history.

## Decks

- **More formats** (brawl, oathbreaker, historic…), and partner and background checks for Commander.
- **Deck statistics:** mana curve, color pips, card-type breakdown (lesson 09's exercise 5 has
  the curve function).
- **Sharing decks** with the playgroup (read-only links), and a "cards to get" list across all
  your decks.
- **Strict ownership as an option:** a copy used by one deck can't be used by another.

## Trades

- **A client-side trade builder** (no page load per "+ add"). The draft race it would have fixed
  is fixed already (design doc 10, section 13).
- **Trade expiry** after N days, and a cap on open proposals per player (lesson 10's exercises).
- **Notifications** beyond the badge (e-mail isn't set up; a feed item comes with Phase 11).

## Players and economy

- **Public player profiles**: history, total spent, self-funded amounts. The ledger already
  records everything needed.
- **Config error messages** could suggest `direnv reload` when a variable is missing (declined
  for now).

## Testing

- **Remote test suite** (`pnpm test:remote`, never run by default): a handful of checks against
  the real MTGJSON and Scryfall endpoints, to notice when their formats change. Automated tests
  stay offline (recorded fixtures, local image responses).
