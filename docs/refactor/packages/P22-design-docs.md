# P22. Review and consolidate the design docs

- **Branch:** `refactor/P22-design-docs` · **Depends on:** P18, P30 (the module layout it documents) · **Parallel with:** P20, P21, P31–P34 (P22 touches only `docs/design/`, `docs/modules/`, a new check script and `scripts/`; P21 owns `docs/architecture/`)
- **Audit:** this package came from a review on 2026-11-19 (doc 65 change log); no F or D number. The [plan review](../reviews/plan-review/README.md) (report [5](../reviews/plan-review/5-docs-tests-dx.md), finding 3) added the citation check.
- **Lines:** none from source. About +60 lines for the check script and its test. Docs get shorter to read, not deleted.

## Deletes

Docs only, and nothing is deleted from history:

| What                                                                                                                                      | Where                                               | Lines                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| Design docs whose rules all live in `docs/modules/` now: moved (`git mv`), not deleted                                                    | `docs/design/NN-*.md` → `docs/design/archive/`      | moved, about 8,000 to 12,000 of the 16,000 lines |
| Stale "where the code goes" sections that planned the duplicated layout (doc 28 and others)                                               | marked superseded in the Status line, not rewritten | 0                                                |
| The design docs for features P24 deleted (60, the card-packages parts of 59, the roadmap parts of 57–58): add a "Superseded in part" line | those docs                                          | 0                                                |

## Why

The 63 design docs were each written for one feature, without looking back at the others. Their
product rules mostly still hold, but:

- Many docs change the same subsystem without saying so: role tags appear in 14 docs,
  suggestions and replacements in about 30, opening hands in 8. To learn how something works
  today you'd read them all, in order.
- Their "where the code goes" sections planned the duplicated layout the refactor removes (doc 28
  describes tools wrapping queries in the app layer, which ADR 0026 replaces).
- 8 were self-approved during unattended runs (06–11, 20, 21): the user never
  reviewed their decisions.
- Numbers 47 and 48 are each used twice; 50, 62 and 63 don't exist.

Design docs are a record of **why** a feature was built. This package doesn't rewrite them. It
pulls the rules that still hold into one current page per responsibility, and marks the old docs
so nobody mistakes them for the current design.

## Goal

- One living reference per responsibility, `docs/modules/<responsibility>.md`, listing the
  product rules the code must keep, each with a link to the doc it came from.
- Every design doc marked **current**, **superseded in part** or **superseded**, and the
  superseded ones moved to `docs/design/archive/`.
- The user has confirmed or changed every decision in the self-approved docs.
- Every contradiction between docs is a `Decision: …` task, or resolved.

## Touches

`docs/design/*.md` (Status lines only), new `docs/design/archive/`, new `docs/modules/`,
`docs/design/README.md` or `docs/README.md` (the index), `docs/refactor/dedup-playbook.md` (the
doc map). **Avoid:** `docs/architecture/` (P21), source code.

## Steps

1. **Inventory.** A table in `docs/design/README.md` (create it): number, title, module or
   responsibility it belongs to after P18, status (current / superseded in part / superseded),
   and what superseded it. Start from the "Superseded in part" lines packages added (playbook,
   Part A step 15) and the doc map in the playbook. One row per doc, all 63.
2. **One responsibility at a time**, in this order (the most-layered first): deck advice
   (suggestions, ratings, replacements, optimizer), card features (tags, themes, signals), deck
   play (test hands, odds, goldfish), LLM tools, decks, then the rest. For each:
   1. Read the docs for it, oldest first. Note every rule a player would notice (what's counted,
      what's allowed, defaults, limits) and every decision.
   2. Check each rule against the code on `refactor/main` (a test, or the function that
      implements it). Keep rules the code follows. If the code and the doc disagree, or two docs
      disagree, write it down; don't pick one.
   3. Write `docs/modules/<responsibility>.md`: a short intro, then the rules as a numbered list,
      each with `(doc NN §x)` after it. Under 300 lines; it's a reference, not a history.
3. **Disagreements.** For each, create a tududi task `Decision: …` in the refactor project with
   both versions and where each comes from, `related_to` this package. List them in STATUS under
   "Decisions needed". Don't resolve them yourself.
4. **Self-approved docs.** List each one's decisions (one line each) in a single tududi task
   `Decision: confirm the self-approved design decisions`, for the user to go through. Mark
   accepted ones in the doc's Status line ("confirmed by the user, date").
5. **Archive.** A doc whose every rule now lives in `docs/modules/` and whose layout sections are
   replaced: add `- **Superseded** (date): by docs/modules/<x>.md` under its Status, and
   `git mv` it to `docs/design/archive/`. Fix links to it (`grep -rn "design/NN-" docs lessons src`).
   Docs with rules still only in them stay where they are.
6. **The citation check.** Code comments, ADRs, lessons and docs cite design docs about 900 times
   ("design doc 28", "doc 28", `docs/design/28-…`). The review counted 891; a plain
   `grep -rniE "design doc [0-9]+" src worker tests scripts docs lessons` finds more, because it
   includes tests: use the script's own count. Archiving must never leave a citation pointing
   nowhere.
   - Add `scripts/dev/check-doc-citations.ts` and `"docs:citations": "tsx scripts/dev/check-doc-citations.ts"`.
     It scans `src`, `worker`, `tests`, `scripts`, `docs`, `lessons` and the README for
     `design doc NN`, `doc NN` (only when `design` or `docs/design` appears in the same file or the
     phrase is "design doc"), and `design/NN-name.md` links. For each number it checks that
     `docs/design/NN-*.md` **or** `docs/design/archive/NN-*.md` exists. The numbers with two docs
     (47, 48) are fine; the missing ones (50, 62, 63) are listed in an allowlist with a reason, and
     any other missing number fails. Links with a path must point to a file that exists.
   - Unit-test the matcher on a few lines, including "design doc 09" and `docs/design/archive/…`.
   - Add it to `scripts/dev/check.sh` once it exits 0. Run it before **and** after step 5's moves; it
     must pass both times.
7. **Numbering.** Don't renumber (it breaks links from lessons, ADRs and code comments). Note in
   the index that 47 and 48 each have two docs and 50, 62, 63 don't exist.
8. **Template.** `docs/design/TEMPLATE.md` gains a line: a new design doc names the
   `docs/modules/` page it changes, and updates that page when it's built.

## Done when

- `pnpm docs:citations` exits 0, and `pnpm check` runs it.
- `docs/design/README.md` lists all 63 docs with a status.
- Every responsibility in the P18 layout has a `docs/modules/` page, or the index says why not.
- No unresolved contradiction is left only in the docs: each is a decision task or fixed.
- The self-approved decisions task exists and is in the user's hands.

## Re-check the numbers

```bash
ls docs/design/[0-9]*.md | wc -l; ls docs/design/archive 2>/dev/null | wc -l; ls docs/modules 2>/dev/null
grep -l "Superseded" docs/design/*.md | wc -l
grep -rhoE "design/[0-9]{2}-[a-z0-9-]+\.md" docs lessons src | sort -u | while read p; do [ -e "docs/$p" ] || echo "broken: $p"; done
```

## Handoff

**Branch** `refactor/P22-design-docs` (from `refactor/main` at "STATUS: P34 steps 1-5 merged").
Commits: the citation check; the 14 `docs/modules/` pages and the Status lines; the archive, the
inventory and the link fixes; this handoff.

**Inventory** (`docs/design/README.md`, 67 rows: the plan said 63, but 47 and 48 each have two docs and
there are 65 numbers from 02 to 69 less 50, 62 and 63): **15 current, 11 superseded in part, 41
superseded** (archived to `docs/design/archive/`, same file names).

**Pages** (`docs/modules/`, rules numbered with `(doc NN §x)` and the test that holds them):
decks-core 29, decks-scoring 20, decks-building 17, decks-play 13, decks-proxies 13, llm-tools 21,
card-features 15, catalog 17, economy 20, game-collection 14, real-collection 9, drafts 14,
accounts 11, platform 4 (197 rules). `decks/overview`, `reddit` and `youtube` have no page of their
own (the index says why). `catalog` and the collections are written by responsibility, so they survive
P30; `game-collection.md` and `real-collection.md` are the two P30 merges into one module.

**Citation check.** `pnpm docs:citations` (`scripts/dev/check-doc-citations.ts`, unit-tested, in
`scripts/dev/check.sh`): before this package 1,535 citations, none broken; after the pages 1,600; after
the 41 moves 1,600, none broken (21 files had `design/NN-` links rewritten to `design/archive/NN-`,
all in docs and lessons; no application code changed). **Production lines: +105** (the script; the
`sizes` check therefore reports 76,715 against a 76,610 baseline: the owner's call, the baseline is not
edited). The plan said about +60.

**Self-approved docs.** `docs/decisions-to-review.md` shows the owner reviewed docs 06-11 and approved
20 and 21 on 2026-10-06 (one decision changed: the store pays at least 1 cent). Their Status lines now
say so. What that file still lists as not reviewed: "Changes from your testing", "Fixes from your
testing", "Launch preparation" and "Deck builder 2.0 and proxy PDFs" (doc 14).

**Disagreements** (code followed in every case; each is on the page named):

1. Role targets for 60-card formats: doc 19 §13.2 says Commander only; doc 44 and the code give 4/6/6/2 (decks-core rule 11).
2. Tool response size: doc 61 §4 rule 7 says about 40 KB; the code caps at 14,000 bytes (llm-tools).
3. List limits: doc 28 §4 rule 7 (pages of 25, 8 queries x 50, 200 merged) vs `search_cards` (6 queries, limit 1-20, default 10) (llm-tools).
4. OAuth redirect URIs: doc 30 §4 rule 1 says at most 5; the code and doc 69 say 20 (llm-tools).
5. EDHREC sync: doc 45 §11.1 says 14 days and 50 a night; the code has 30 days and 200 (catalog).
6. Kind-priced products in `msrp` mode: doc 33 §4 rule 2 says never below resale; the code sells at the kind price (economy).
7. Wishlist sharing: doc 51 says private until `isShared`; doc 48 §13.2 and the code use profile visibility, default friends (game-collection).
8. Doc 13 §4 rule 3 (images on first view) vs §13.4 (everything downloaded at sync time).
9. Second weight table: doc 39's commander coverage and power scores live in `COMMANDER_WEIGHTS` beside `RATING_WEIGHTS` (owner D1: one scorer, if simpler) (decks-building).
   Also noted, not conflicts: the tools doc 47, 56, 57 and 59 describe (`audit_deck`, `diff_deck`,
   `upgrade_roadmap`, `suggest_swaps`) no longer exist; whether any returns is open.

**Left.** Docs kept in place with something not on a page: 02, 03, 04, 06, 08, 13 (some decisions not
re-verified), 14 and 15 (the search keyword lists), 18 (per-card Conspiracy rules), 19, 28, 30, 33, 39,
40, 45, 51, 58, 59, 61 (disagreements above), 49 (contrast numbers, P33), and 65-69. After P30 merges,
update `catalog.md`, `game-collection.md` and `real-collection.md` for the new layout. Rule numbers in
the pages cite design docs by section number, which the archive keeps.
