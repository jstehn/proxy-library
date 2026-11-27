# catalog: cards, rules and outside data

Where every card, set, product, price and image comes from, and what is kept from the outside
services (Scryfall, MTGJSON, Wizards Play Network, EDHREC, Commander Spellbook, the Comprehensive
Rules). Written by responsibility (cards, rules, outside data), not by folder, because P30 is
reshaping `src/modules/catalog/` (ADR 0030). What a card does (roles, themes, signals) is in
`card-features.md`. Checked against `refactor/main` (2026-11-20) by the tests or constants named in
brackets.

## Cards and sets

1. **Only the sync talks to MTGJSON and Scryfall,** through gateways, Zod parsing and pure mappers;
   nothing else sees their raw JSON. Tests use recorded fixtures, never the network. (doc 04 §4
   rule 1, ADR 0007; `gateways.test.ts`, `mtgjson-mapper.test.ts`)
2. **One sync at a time:** an advisory lock; a second request waits. A set is imported in one
   transaction: its printings, booster configs, products and deck lists change together or not at
   all. (doc 04 §4 rules 3 and 6; `drizzle-repositories.ts`)
3. **One price snapshot per printing, finish and day;** re-running on a day overwrites that day, past
   days never change; every day is kept. (doc 04 §4 rule 7, §14.3; `price_snapshots` primary key)
4. **Paper only.** Exclude something only when it exists only digitally: online-only sets,
   printings not available in paper, digital booster types (`play-arena`, `-arena`, `-mtgo`), MTGO
   redemption products and decks. A Commander precon also on Arena is kept. The import reports what
   it skipped, and every card a kept booster, product or deck refers to must be an imported printing
   (checked before committing). (doc 04 §4 rule 9, rule 5; `rules.test.ts`)
5. **Printings are in their own language** as MTGJSON lists them; Scryfall entries match by exact
   id in any language, so a translation never replaces an English card. (doc 04 §4 rule 8)
6. **Enabling a set enables its supporting sets and its Commander companion set,** and nothing else.
   Expansion, core and Commander sets are enabled the first time they appear; a set an admin turned
   off stays off; other types (promos, tokens, Masters, Un-sets) stay off unless enabled.
   (doc 04 §4 rules 5, 11, 13; `companions.test.ts`, `default-enabled.test.ts`)
7. **A set released in the last 120 days, or not yet released, is re-imported on every `prices`
   run** (MTGJSON fills in boosters and precons late); older sets only on a `full` run, and a set is
   skipped when MTGJSON's version for it has not changed. (doc 04 §4 rules 4 and 12; `settling.test.ts`)
8. **Tokens and art cards from MTGJSON set files are not imported** (doc 04 §14.4); tokens, emblems
   and helper cards come instead from Scryfall's bulk file into `token_printings`, linked to the
   cards that make them (doc 25 §3.1, `schema.ts`). A **reference set** (a paper set not
   enabled) keeps cards for the real collection to match against. (doc 04 §14.4, doc 16 §14.2;
   `reference-sets.test.ts`)
9. **Nightly sync at 04:00** server time (`SYNC_TIME`); the check fires at most once per day. (doc 04
   §14.1; `config.test.ts`, `rules.test.ts`)
10. **Politeness.** Requests per second: Scryfall 8, MTGJSON 4, card images 10, WPN pages 1,
    EDHREC 1, Commander Spellbook 1, Comprehensive Rules 1, with a descriptive `User-Agent`; the
    Scryfall bulk file is downloaded at most once per Scryfall update and cached on disk; card
    images are fetched once, when first viewed (owner, 2026-11-20), and then served from disk. (doc 04 §4 rule 10, doc 13 §4 rule 3, doc 45
    §4 rule 5, ADR 0007; `core.ts` `politeFetch`)
11. **Embeddings** (for semantic search and similarity) are computed by the worker, incrementally:
    only cards with no row or a stale `(model, text version)`. (doc 53 §5 rule 4; `embed.test.ts`)
12. **Contents MTGJSON lacks can come from our own files** (`data/sealed-contents/<SET>.json`,
    folder set by `SEALED_CONTENTS_DIR`). A file fills in only products MTGJSON lists with no
    contents, so upstream wins as soon as it has them; entries it can't use are reported in the sync's
    `leftOut`, never fatal. Prices stay with the admin. (ADR 0031; `contents-overrides.test.ts`)

## Product imagery and details (WPN)

12. **Only official Wizards imagery,** only from Wizards' image host (any other URL is rejected by the
    gateway), never altered (no crop, recolour or overlay), with the Fan Content Policy notice on every
    page; the public page is read as a browser would, never with its embedded access token. (doc 13 §4
    rules 1, 2, 6, 7; `wpn.test.ts`)
13. **A missing or changed page, or a failed download, means generated art, never an error;** an
    admin's choice (a photo or "no photo") is kept by every later sync. Cases, "Set of N" bundles and
    displays of decks are never matched; Commander decks keep generated art with their commander;
    the match picks the closest name and never ignores a product-type word. (doc 13 §4 rules 4-5,
    §13.1-2; `wpn.test.ts`)
14. **Official MSRP, contents text and release dates are kept** from WPN (as plain text, never its
    HTML); an admin's own price wins; a product without an official MSRP keeps its kind's price.
    (doc 13 §13.5; `wpn.test.ts`, see `economy.md` rule 2)

## Rules and combos

15. **The Comprehensive Rules** are parsed into sections, rules, subrules and glossary entries with
    unique rule numbers (glossary as `glossary:<slug>`), the version is the effective date, parsing is
    idempotent, and the sync skips download and embedding when the version is unchanged. `rules_lookup`
    reads this table, never the network. (doc 60 §3.2, §13.3; `comprehensive-rules.test.ts`)
16. **Two-card combos** come from Commander Spellbook into `spellbook_two_card_combos` with the pair
    ordered by card id (`A <= B`) so a pair is stored once; Ruthless maps to bracket 4 and Spicy,
    Powerful and Casual to 3, falling back to mana value; the browser-side bracket code gets the combos
    passed in. No request handler calls the network. (doc 52 §4; `spellbook.test.ts`)
17. **EDHREC data** is read from our tables only (`inclusionRate` clamped to [0, 1], `synergy` to
    [-1, 1], enforced in the mapper and by database checks); one row per commander and card (the
    highest deck count wins); names are formatted as EDHREC does and a double-faced commander uses its
    front face; a commander with none behaves as if there were no data; partner commanders take the
    larger value per card. (doc 45 §4 rules 1-4, §11.2; `edhrec.test.ts`)

## Disagreements recorded here (for the project manager)

- **EDHREC sync cadence:** doc 45 §11.1 says a 14-day refresh and up to 50 missing or stale commanders
  per night; the code uses `EDHREC_STALE_DAYS = 30` and `EDHREC_NIGHTLY_LIMIT = 200`. Decided 2026-11-20 (owner): the code; doc 45 is marked.
