# P22. Review and consolidate the design docs

- **Branch:** `refactor/P22-design-docs` · **Depends on:** P18 · **Parallel with:** P20, P21 (P22 touches only `docs/design/` and the new `docs/modules/`; P21 owns `docs/architecture/`)
- **Audit:** this package came from a review on 2026-11-19 (doc 65 change log); no F or D number
- **Lines to remove:** none from source. Docs get shorter to read, not deleted

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
6. **Numbering.** Don't renumber (it breaks links from lessons, ADRs and code comments). Note in
   the index that 47 and 48 each have two docs and 50, 62, 63 don't exist.
7. **Template.** `docs/design/TEMPLATE.md` gains a line: a new design doc names the
   `docs/modules/` page it changes, and updates that page when it's built.

## Done when

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

(empty)
