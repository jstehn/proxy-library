# Decisions to review

Phases 6–11 were built in one unattended overnight run (2026-09-27 → 28). Design docs were
**self-approved** so work could continue. Everything decided without you is listed here, so you can
review it in one place. Anything can still be changed.

## Start here

Everything on the roadmap is built (Phases 0–11), with a lesson per phase. To see it all:

1. `direnv reload`, then `pnpm install`, `pnpm db:migrate`, restart `pnpm dev`.
2. Things to try: open the repaired Reality Fracture precon in **Inventory** (it becomes a deck in
   **Decks**), buy a Secrets of Strixhaven precon, **Collection** sections, the deck builder's
   type-ahead, a trade between two accounts, **Activity** on the home page, the export links, and
   the phone layout.
3. Deploying: [deploy.md](deploy.md).
4. Then read the tables below and tell me what to change.

## Answered by you before the run

| Topic                 | Decision                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review gates          | Self-approve each design doc, choose recommended options, and list judgement calls here                                                            |
| Selling singles       | The store pays **50%** of market price (admins can change it)                                                                                      |
| Decks and ownership   | **Shared:** each deck may use every copy you own. The builder shows which other decks use a card, and flags decks left short after a sale or trade |
| Opening sounds        | **Generated in the browser** (Web Audio API), with no sound files                                                                                  |
| Product and set art   | **Generated SVG art only.** Retailer photos wait for your decision on their terms                                                                  |
| Boxes and bundles     | **Unpack into inventory:** open each pack yourself, or "open all"                                                                                  |
| Activity feed         | Everyone sees **notable pulls, sealed purchases and completed trades**. Money amounts other than card prices stay private                          |
| Trades                | **Cards and money** on either side; accept, decline or cancel; a counter-offer is a new proposal                                                   |
| Docker                | Pull base images and **test the whole stack locally**                                                                                              |
| Collection export     | **Moxfield CSV, plain text list, full CSV**                                                                                                        |
| Tests and the network | Automated tests never call real APIs or image hosts. Real-endpoint checks go in an opt-in `pnpm test:remote` suite                                 |

## Judgement calls made during the run

Each entry: the phase, what was decided, why, and where to change it.

### Phase 6: store and inventory

| Decision                                                                                                                                                                                                                                                                                                                                                                                   | Why                                                                            | Where to change it                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| **Default MSRPs** (US, 2024–26): play pack $5.49, draft $4.49, set $4.99, collector $24.99, Jumpstart $5.99; play box $164.64, draft box $143.64, set box $149.70, collector box $269.99, Jumpstart box $139.99; bundle $59.99, gift bundle $69.99, premium bundle $89.99; prerelease kit $29.99; draft kits $149.99; Commander deck $44.99; theme/other decks $14.99; starter kits $19.99 | Close to real shelf prices, so a $20 weekly allowance feels like a real budget | `/admin/store` (per kind or per product)            |
| **Cases, welcome decks, sample and promotional packs are not for sale** by default                                                                                                                                                                                                                                                                                                         | Cases are six boxes at once, and the rest are free in real stores              | Give their kind a price on `/admin/store`           |
| **At most 24 of one product per purchase**                                                                                                                                                                                                                                                                                                                                                 | Stops a typo from emptying a wallet                                            | `MAX_QUANTITY` in `store/domain/pricing.ts`         |
| **Only enabled sets are in the store**                                                                                                                                                                                                                                                                                                                                                     | Enabling a set is how an admin puts it on sale                                 | `/admin/catalog`                                    |
| **A single-pack product becomes a pack straight away** (no "unpack" step)                                                                                                                                                                                                                                                                                                                  | Buying a pack should give a pack to open                                       | `itemForProduct` in `inventory/domain/item.ts`      |
| **Owned packs stay openable if their set is disabled later**                                                                                                                                                                                                                                                                                                                               | Disabling a set shouldn't take away what people bought                         | `drizzleBoosterSource`                              |
| **Generated product art is HTML/CSS**, colored by a hue derived from the set code, with the set's most valuable rare or mythic as the picture                                                                                                                                                                                                                                              | Uses the Keyrune font and cached card images directly, with no new downloads   | `src/ui/product-art.tsx`                            |
| **"Open all" stops after 500 openings**                                                                                                                                                                                                                                                                                                                                                    | Keeps one click from running for minutes                                       | `OPEN_ALL_LIMIT` in `inventory/application/open.ts` |
| **Store transactions also record sealed purchases** (a small generalization of ADR 0013, which described singles)                                                                                                                                                                                                                                                                          | One ledger of everything bought from the store                                 | `store/infrastructure/schema.ts`                    |

### Phase 7: collection and singles

| Decision                                                                                                                             | Why                                                                   | Where to change it                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------- |
| **Serialized cards are ordinary stacks** (no individual serial numbers yet)                                                          | Keeps the collection simple; listed in future-ideas                   | ADR 0011's open question                     |
| **Payout is rounded down per copy, then multiplied**                                                                                 | Selling 3 at once or one at a time pays the same                      | `payoutPerCopy` in `store/domain/singles.ts` |
| **Cards worth $0.00 to the store can't be sold** (e.g. a 1¢ common at 50%)                                                           | A sale that pays nothing is confusing, and a ledger entry can't be $0 | `sellSingle`                                 |
| **You can sell any card you own that has a price, even from a set that's no longer enabled**; you can only **buy** from enabled sets | Disabling a set shouldn't trap what people own                        | `sellSingle` / `buySingle`                   |
| **The store sells at the latest snapshot, even if it's a few days old**; the snapshot's day is recorded and shown                    | A failed sync shouldn't close the store                               | `drizzleMarketPrices`                        |
| **Singles are limited to 24 per purchase or sale** (same as sealed)                                                                  | Typo protection                                                       | `MAX_QUANTITY`                               |

### Phase 8: opening experience

| Decision                                                                                                               | Why                                                             | Where to change it                          |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| **CSS animations and a `useReducer` state machine, no animation library** (the original plan named Motion)             | The effects are simple keyframes, with one dependency fewer     | `src/ui/opening/`, `globals.css`            |
| **Our own card back** (a purple swirl with the app's name), not the real Magic back                                    | The real back is Wizards of the Coast's artwork                 | `src/ui/opening/card-back.tsx`              |
| **"Hit" = rare or better, or any card worth $5+**; mythics and $5+ cards get the bigger orange glow and a longer pause | An expensive uncommon deserves its moment too                   | `hitLevel`, `BIG_HIT_CENTS` in `machine.ts` |
| **Only packs animate**; boxes and decks show their results directly (a box's packs animate one after another)          | That's where the suspense is                                    | `src/app/inventory/opened/page.tsx`         |
| **Pulls can be seen in the page source before flipping**                                                               | The server already decided them, so it's a spoiler, not a cheat | future-ideas                                |

### Phase 9: deck builder

| Decision                                                                                                                     | Why                                                                                    | Where to change it                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Basic lands never count as short**                                                                                         | Every playgroup has a box of basics                                                    | `ownershipProblems` in `decks/domain/rules.ts`, and `decksFor` |
| **Problems are shown, never enforced**: you can save a deck that's short or illegal                                          | A half-built deck is still a deck                                                      | `deckProblems`                                                 |
| **Formats: casual, standard, pioneer, modern, legacy, vintage, pauper, commander**                                           | The common ones; others are one table entry each (plus a label and the database check) | `FORMATS`, `FORMAT_RULES`, `FORMAT_LABELS`                     |
| **Partner and background pairs are simplified:** up to 2 commanders, with no check that they may pair                        | Rare, and complex to check                                                             | `commanderProblems`                                            |
| **Only catalog cards** (enabled and supporting sets) can go in decks; a pasted list reports the rest as "not in the catalog" | The catalog is what we have data and images for                                        | enable more sets on `/admin/catalog`                           |
| **Pasted cards get a pinned printing**: the one asked for (set and number), else one you own, else the newest                | Proxies and exports show the version you have                                          | `drizzleCardLookup.resolve`                                    |

### Changes from your testing (2026-09-27, during the run)

| Change                                                                                                                           | Why                                                                                                                      | Where                                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Enabling a set also enables its Commander companion set** (FRC, SOC, BLC, …)                                                   | Precons live in those sets; the Reality Fracture precon was sold empty, and Secrets of Strixhaven's precons were missing | `companionsToEnable` in `catalog/domain/rules.ts`               |
| **Products with nothing to open are left out** of imports, never sold, and refused if opened (`NothingInside`)                   | MTGJSON lists some new products before their contents are known                                                          | catalog rule 5b, store queries, `inventory/application/open.ts` |
| **Your empty Reality Fracture precon was repaired** in the dev database: pointed at the complete FRC product and marked unopened | You paid for it and got nothing                                                                                          | one-off SQL (item 7)                                            |
| **Opened precons become decks** in your deck list (Commander if it has a commander); a bundle's land pack doesn't                | "Buy a precon and have it in my decks"                                                                                   | `createDeckFromCards`, `becomesADeck`, the open action          |
| **Precon products open in one click** (no separate "Unpack" step)                                                                | A precon is a deck in a box                                                                                              | `/inventory`                                                    |
| **Cards show which of your decks use them** (collection and card page)                                                           | So you know which deck to pull a card from                                                                               | `decksUsing`                                                    |
| **Type-ahead search in the deck builder** (↑ ↓ Enter)                                                                            | Faster than search-and-submit                                                                                            | `app/decks/[id]/card-search.tsx`                                |
| **Collection sections**: colors (default), card types, rarity, sets, or none, with any sort within (mana value by default)       | How a collection is normally organized                                                                                   | `collectionPage`                                                |
| **Admin pages moved into an Admin section** with its own menu                                                                    | Keeps the main menu for playing                                                                                          | `app/admin/layout.tsx`                                          |
| **Opener: a spotlight on larger screens, a stack on phones; tapping a seen card on a phone shows it large**                      | Flipped cards were too small to read                                                                                     | `src/ui/opening/pack-opener.tsx`                                |
| **Browser controls follow the dark theme** (`color-scheme`)                                                                      | Dropdown options were light grey on white                                                                                | `globals.css`                                                   |

### Phase 10: trades

| Decision                                                                        | Why                                                                  | Where to change it                           |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| **Nothing is reserved while a proposal waits; acceptance re-checks everything** | Simpler, and a refused acceptance explains exactly what changed      | `carryOut` in `trades/application/trades.ts` |
| **Collections are visible to other players in the trade builder**               | You need to see what someone has to ask for it                       | `/trades/new`                                |
| **Proposals never expire** (either side can end them)                           | Playgroups are small; lesson 10's exercise 2 shows how to add expiry | `decide`                                     |
| **At most $10,000 per side**, 99 copies per card line                           | Same limits as the rest of the app                                   | `checkOffer`                                 |
| **Disabled players can't receive trades**                                       | Rule 2                                                               | `drizzleTradePlayers`                        |

### Phase 11: activity, export, Docker

| Decision                                                                                                                                              | Why                                                               | Where to change it                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| **The feed shows notable pulls (rare, mythic, $5+), sealed purchases (product only, no price) and trades (who, how many cards, whether money moved)** | Money stays private, as agreed                                    | `recordEvent` calls; `activity-list.tsx` |
| **Moxfield export uses "Near Mint" and "English"**                                                                                                    | The app tracks neither                                            | `COLLECTION_EXPORTERS.moxfield`          |
| **One Docker image with the full install** (not the standalone output)                                                                                | The worker needs tsx and the source anyway                        | `Dockerfile`                             |
| **Migrations run as a one-shot `migrate` service** before the app and worker start                                                                    | A failed migration stops startup instead of running half-migrated | `docker-compose.yml`                     |
| **Products no longer in MTGJSON's latest data are unlisted, not deleted**                                                                             | Owned items keep opening; nothing unlisted is sold                | `sealed_products.is_listed`              |
| **The Docker test ran one real first sync** (about 80 MB) before being stopped                                                                        | A fresh install syncs at once; it also proved the worker          | docs/deploy.md                           |

### Requirements audit (2026-09-28)

The full checklist is in [requirements-audit.md](requirements-audit.md).

| Decision                                                                                      | Why                                                                                                       | Where to change it                           |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Nightly runs re-import sets released in the last 120 days** (catalog rule 12)               | Reality Fracture's booster recipes weren't in MTGJSON yet, and nightly runs would never have fetched them | `SETTLING_DAYS` in `catalog/domain/rules.ts` |
| **Unpriced product kinds (Scene Boxes, Tins, Commander Kits, Codex Bundle, …) stay off sale** | Their MSRPs vary within a kind; you choose on Admin → Store                                               | `/admin/store`                               |
