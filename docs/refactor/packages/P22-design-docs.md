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

(empty)
