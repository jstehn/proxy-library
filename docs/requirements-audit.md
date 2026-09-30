# Requirements audit (2026-09-28)

Every request from our conversations, checked against the running app, the code and the dev
database. ✅ done · 🟡 done with a known limit · ⏳ waiting on outside data · ➡️ deferred on
purpose (see [future-ideas.md](future-ideas.md)).

## The core idea

| Request                                                               | Status | Evidence                                                                                          |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| Limited virtual wallet                                                | ✅     | `wallet` module, append-only ledger; `/wallet`                                                    |
| $50/week allowance, $200 starting grant, admin corrections            | ✅     | `wallet/domain/ledger.ts`, economy settings on `/admin/economy`                                   |
| Admin-permitted self-funding; totals spent / self-funded              | ✅     | Admin → Players (balance, spent, self-funded, allow self-funding); visible to admins only for now |
| Buy sealed product at MSRP (single packs too)                         | ✅     | `/store`; MSRP per kind + per-product overrides on `/admin/store`                                 |
| Open with realistic odds (MTGJSON booster sheets and weights)         | ✅     | `packs/domain/generate.ts` (Monte Carlo tests); Pack lab `/admin/packs`                           |
| Balance colors when the sheet says so                                 | ✅     | `balanceColors` in `generate.ts`                                                                  |
| Boxes / bundles / Draft Night unpack into inventory                   | ✅     | `inventory` `unpack`; Draft Night on sale for TMT, MSH, SOS, ECL, HOB                             |
| Polished FX: flips, rarity glow, foil shimmer, generated sounds, mute | ✅     | `src/ui/opening/pack-opener.tsx`, `sounds.ts` (Web Audio), `globals.css`                          |
| Reveal order builds suspense                                          | ✅     | `packs/domain/reveal.ts`                                                                          |
| Readable flipped cards; 7-column grid; phone stack                    | ✅     | spotlight + `normal` image; phone stack; tapping a seen card shows it large                       |
| Collection with sections and sorts                                    | ✅     | `/collection`: sections none/color/type/rarity/set, sorts newest/value/name/mana/set              |
| Singles bought at market price; sold to the store at 50%              | ✅     | `/singles`, card page buy/sell; buylist rate on `/admin/store`                                    |
| Decks only from owned cards; ownership shared across decks            | ✅     | `decks` module `deckProblems`; "In your decks" on cards                                           |
| Deck autocomplete ("swa" → Swamp, arrows + Enter)                     | ✅     | `app/decks/[id]/card-search.tsx`                                                                  |
| Proxy printing                                                        | ✅     | `/decks/[id]/print` (3×3 print sheet)                                                             |
| Opened precons become decks                                           | ✅     | `createDeckFromCards`, `becomesADeck`                                                             |
| Trades: cards and money, counters, one transaction                    | ✅     | `trades` module (`decide`, `carryOut` with `lockWallets`)                                         |
| Per-account libraries; invite codes; username + password (min 6)      | ✅     | `accounts` module, `PASSWORD_MIN_LENGTH = 6`; first sign-up becomes admin                         |
| Activity feed: pulls, purchases, trades, money private                | ✅     | `activity` module, `/activity`                                                                    |
| Exports: Moxfield CSV, text list, full CSV                            | ✅     | `/api/export/collection`, deck export                                                             |
| Hover to enlarge cards                                                | ✅     | `app/_components/card-tile.tsx`                                                                   |
| Dark theme dropdowns readable                                         | ✅     | `color-scheme` in `globals.css`                                                                   |
| Admin functions in their own section                                  | ✅     | `app/admin/layout.tsx`                                                                            |

## Data

| Request                                                    | Status | Evidence                                                                                                                                                   |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MTGJSON + Scryfall, cached, batched, polite                | ✅     | set files per enabled set; one bulk file per Scryfall update; images cached on disk (ADR 0007)                                                             |
| Standard sets first; nightly sync + "Sync now"             | ✅     | 20 Standard sets + 15 Commander companions enabled; `/admin/catalog`                                                                                       |
| Commander version of a set enabled by default              | ✅     | `companionsToEnable`                                                                                                                                       |
| Paper only, excluding only digital-only things             | ✅     | design doc 04 rule 9; e.g. `MSH: play-arena` skipped                                                                                                       |
| A product that opens to nothing is a bug                   | ✅     | rule 5b, `NothingInside`, store filter; `worker check-products` passes                                                                                     |
| **New sets fill in later without a manual full sync**      | ✅ new | **Rule 12 (added in this audit):** nightly runs re-import sets released in the last 120 days or not out yet                                                |
| Reality Fracture booster packs                             | ⏳     | MTGJSON has no FRA booster recipes yet (checked 2026-09-28), so FRA packs, boxes and Draft Night are held back. The nightly run adds them when they appear |
| Echoverse pairs in Reality Fracture                        | ➡️     | noted in future-ideas; needs the booster data first                                                                                                        |
| Automated tests never hit the network; opt-in remote suite | ✅     | fixtures in `tests/fixtures/`; `pnpm test:remote` is separate                                                                                              |

## Products that exist but aren't for sale

They're listed, they have contents, and they open fine, but no price is set for their kind, so
the store hides them (design doc 06, rule 1). An admin can sell any of them by giving the kind or
the product a price on **Admin → Store**. None were priced automatically: their MSRPs vary too
much within a kind, and guessing would be wrong.

| Kind                                     | Products | Examples                                    | Suggestion                                    |
| ---------------------------------------- | -------- | ------------------------------------------- | --------------------------------------------- |
| `box_set/other`                          | 26       | Scene Boxes, Tins, Play Packs, Deck Builder | price individually if the group wants them    |
| `subset/commander`                       | 17       | "Commander Decks Set of 4"                  | leave: the single decks are sold              |
| `deck/welcome`                           | 31       | Welcome Decks (free in stores)              | leave unsold, or price at $0.01 as a freebie  |
| `unknown/commander`, `box_set/commander` | 9        | Tarkir / Marvel Commander Kits              | price individually                            |
| `booster_pack/prerelease_kit`            | 6        | TDM Prerelease Boosters                     | leave: the prerelease kits are sold at $29.99 |
| `booster_pack/promotional`, `…/topper`   | 14       | Collector Sample Packs, box toppers         | leave: they come inside other products        |
| `bundle/unknown`                         | 1        | Secrets of Strixhaven Codex Bundle          | price individually                            |
| `booster_pack/unknown`                   | 1        | Marvel Super Heroes Jumpstart 2 Booster     | price individually                            |
| display and case kinds (`deck_box/*`, …) | 12       | Commander Deck Displays                     | leave: the single decks are sold              |

## Deferred on purpose

Public profiles and public spending totals, retailer product photos, spoiler-proof reveals, image
cache warming, and Echoverse pairs: see [future-ideas.md](future-ideas.md).
