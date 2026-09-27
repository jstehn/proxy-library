# 0011. Track every card at exact printing × finish granularity

- **Status:** Proposed
- **Date:** 2026-09-26

## Context

A pulled card isn't just "Lightning Bolt". It's a specific **printing** (set, collector number,
language), in a specific **finish** (nonfoil, foil, etched), often with a **treatment** (full art,
borderless, showcase, extended art, textured/galaxy/surge foil, serialized…). Players care about
these differences because they're part of the fun of opening packs. They also change the market
price and the card image.

MTGJSON already models this. Each printing has its own `uuid`, and booster **sheets list printing
uuids** with a `foil` flag, so the pack engine naturally produces exact printings.

## Decision

- **Catalog:** the unit is the **printing** (`PrintingId` = MTGJSON uuid, with `scryfallId` for
  images and prices). Each printing stores:
  - identity: `setCode`, `collectorNumber`, `language`, `name`, `oracleId` (links all printings of
    the same card)
  - available `finishes`: `nonfoil | foil | etched`
  - **treatments**: `isFullArt`, `borderColor` (e.g. borderless), `frameEffects` (showcase,
    extendedart, …), `promoTypes` (galaxyfoil, surgefoil, textured, serialized, …), `frameVersion`
  - a derived, human-readable `variantLabel` (e.g. "Borderless · Showcase") computed by one pure
    mapper, so the UI never interprets raw MTGJSON codes itself
- **Prices** are per printing **and** finish (`usd`, `usd_foil`, `usd_etched` from Scryfall).
- **Collection:** owned cards are keyed by **(`PrintingId`, `Finish`)** with a quantity. A foil
  and a nonfoil copy of the same printing are separate stacks. The acquisitions log records the
  exact printing and finish of every copy gained or lost, and where it came from (pack, store, trade).
- **Pack generation** emits `{ printingId, finish }` per slot. The finish comes from the sheet's
  `foil` flag, or `etched` when that's the printing's only foil finish.
- **Store and sell-back** operate on a specific printing × finish at that pair's price.
- **Decks** check ownership by `oracleId` (any printing counts toward legality), but each deck
  entry can **pin a preferred printing and finish** for display, export and proxy sheets.
- **Opening FX** receive the finish and treatments so they can render the right effect (standard
  foil shimmer vs etched vs galaxy/surge, full-art frame).

## Consequences

- ✅ Pulls, collection, prices and images all show exactly what you opened.
- ✅ Matches MTGJSON's model, so no lossy translation.
- ❌ More rows (every variant is its own printing) and a wider catalog table. It's still small in
  absolute terms.
- ❌ Collection views must group by `oracleId` for "how many Bolts do I have" and split by
  printing for "which ones". Both are simple queries (ADR 0006).

## Open question

- **Serialized cards** (e.g. "#127/500") are unique physical objects. Options: (a) treat them as a
  normal stack, or (b) store individual copies with a randomly assigned serial number. **Proposal:**
  (b), as `owned_serialized(id, user_id, printing_id, serial, max_serial)`. It's used only for
  printings with the `serialized` promo type and decided in the collection design doc (Phase 7).

## Alternatives considered

- **Track by card name/oracle only:** loses the variant, which is the whole collector experience.
- **Treat finish as part of the printing id:** Scryfall and MTGJSON both keep finish separate from
  printing, so combining them would fight the source data.
