# 0007. Keep external card data behind an anti-corruption layer and sync in bulk

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Card data comes from MTGJSON (sets, booster sheets, sealed product contents) and Scryfall (prices,
images, legalities). Both have large, evolving JSON schemas and usage etiquette (Scryfall: ≤10
req/s, `User-Agent` + `Accept` headers, prefer bulk data). The app must work fast and offline
from these services during play.

## Decision

- Only `catalog/infrastructure` talks to MTGJSON and Scryfall, via gateway ports
  (`MtgjsonGateway`, `ScryfallGateway`).
- Raw payloads are **Zod-parsed** in the gateway (only the fields we use, with unknown keys
  stripped) and turned into domain types (`CardSet`, `Printing`, `BoosterConfig`,
  `SealedProductDef`, `Price`) by **pure, tested mappers**.
- **Sync, don't proxy:** the worker imports data into Postgres. Request handlers never call the
  catalog APIs, except for image cache misses.
  - MTGJSON: `SetList.json` + per-set files for **enabled sets only**. Skip when `meta.version` is
    unchanged.
  - Scryfall: daily **bulk `default_cards`** file, stream-parsed. Gaps are filled via
    `POST /cards/collection` in **batches of 75**, rate-limited.
  - Upserts in chunks (`INSERT … ON CONFLICT DO UPDATE`).
- Images: `ImageStore` port with a disk adapter, fetched once from the Scryfall CDN on a miss,
  then served with immutable cache headers.

## Consequences

- ✅ An upstream schema change touches one mapper plus its fixture test.
- ✅ Gameplay never waits on or overloads external APIs.
- ❌ Data is up to one sync old (prices are daily anyway).
- ❌ We store a slice of the catalog locally (fine: tens of MB for dozens of sets).

## Alternatives considered

- **Call Scryfall per card on demand:** slow, rate-limited, fragile.
- **Import MTGJSON AllPrintings:** 400MB+ for mostly unused sets.
