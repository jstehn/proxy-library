# P10. Formats as a strategy table

- **Branch:** `refactor/P10-formats` · **Depends on:** P09c · **Parallel with:** P11–P14
- **Audit:** doc 65 F3, D14
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S6](../dedup-playbook.md#s6) · **Lines to remove:** about −150 to −300

## Goal

Only `format-rules.ts` knows how formats differ. Everything else asks a question
(`rules.hasCommandZone`), so adding a format is a compile error until every rule is filled in.

## Touches

`src/modules/decks/domain/format-rules.ts`, and every file with a `format === "…"` check
(command below). Today that's mostly `decks/domain/{stats,packages,draft-deck,rules,rate}.ts`,
`decks/queries/*`, `decks/application/*`, the bindings, and `app/decks/[id]/builder/*`.
**Avoid** anything that parses oracle text (P11–P14).

## Steps

1. Group the checks by the question they ask: deck size, copy limit, command zone, color
   identity, brackets apply, sideboard size, opening hand, curve guide, suggestion knobs.
2. Add each as a field of `FormatRuleSet`. Define `FORMAT_RULES` as
   `{…} satisfies Record<Format, FormatRuleSet>`, and a `formatRules(format)` lookup.
3. Replace every check. Client code gets the rules from `decks/client.ts`.
4. Lint: forbid `format === "<literal>"` and `format !== "<literal>"` outside `format-rules.ts`.

## Done when

- The command below finds nothing outside `format-rules.ts` and tests.

## Re-check the numbers

```bash
grep -rnE 'format (===|!==) "' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -v format-rules.ts
```

## Handoff

**Rules that had to survive** (design docs 09, 14, 31, 40, 44, 61: Invariants, Decisions, Out of
scope): the maybeboard counts nowhere; Commander is exactly 100 with a singleton and a color
identity; brackets exist only on Commander decks, and a deck leaving Commander loses its target
bracket (31, invariant 8); Limited is 40 cards, any copies you opened, any card, conspiracies
excluded from the count (17, CR 905.4); 60-card formats have a 15-card sideboard and a 4-copy limit,
restricted cards 1 (44); problems are reported, never enforced. All unchanged, and the old tests
that cover them (`rules.test.ts`, `stats.test.ts`, the goldfish and mana-base tests) pass untouched
except where they called a deleted function.

**Inventory I started from:** 54 `format ===` checks in 29 files (the playbook's command), plus
three tables of their own: `rules.ts` `FORMAT_RULES` (kind-based), `format-rules.ts` (goldfish) and
the `deckSize`/`suggestedLands`/`roleTargets` functions in `stats.ts`.

**Done:**

- **One table.** `decks/domain/format-rules.ts`: `FORMAT_RULES = {…} as const satisfies
Record<Format, FormatRuleSet>` and `formatRules(format: string)` (a name that isn't a format gets
  Casual's rules). Fields (the questions): `deckSize`, `reportsShortDeck`, `sideboardSize`,
  `suggestedLands`, `landTargetFollowsCurve`, `copyLimit`, `plannedCopyLimit`, `buildsFromOwnedPool`,
  `legalityChecked`, `hasCommandZone`, `commandZoneTaxPerCast`, `usesColorIdentity`, `bracketsApply`,
  `conspiraciesLeaveDeck`, `freeFirstMulligan`, `roleTargets`, `roleGuideName`, `curveGuide`,
  `optimizerTargetManaValue`, `roleSlotSaturation`, `canDraftDeck`, `hasConstructedVariants`. Browser
  code gets it from `@/modules/decks/client`; the server from `index.ts`. The file imports types only.
- **Deleted:** `rules.ts`'s kind table and `formatRulesSummary`, `stats.ts`'s `deckSize`,
  `suggestedLands`, `roleTargets` and role tables, `getFormatRules` (and its `brawl`/`oathbreaker`
  rows: not formats, nothing reachable passes them), the local `curveGuide` (twice),
  `slotSaturationThreshold`, `DEFAULT_ROLE_TARGETS`, `CONSTRUCTED_60_FORMATS` (now derived).
  `deckProblems` is driven by the fields (command zone, short deck, sideboard, copies, legality)
  instead of a `switch` on a kind; the order of problems is unchanged.
- **One SQL helper:** `legalInFormat(format)` in `queries/candidate-pool.ts` replaces four copies of
  the same legality condition (browse, suggestion SQL, search-for-deck, mana base).
- **Lint** (`FORMAT_NAMES` in `eslint.config.mjs`, added to every `no-restricted-syntax` block that
  covers deck code, plus the `src/app` block): forbids `format === "<literal>"` and `!==`, also on
  `x.format`; not on `legalities[format]`. `format-rules.ts` and tests are exempt. Checked: a probe
  file fails in `src/modules` and in `src/app`.
- **The importer's `format === "list"`** (`app/collection/real/import/importer.tsx`) is the file
  type being read, not a deck format; the local is now `fileType` so the command is empty.
- **`ListPreviewSummary`** (removal-list row, "P10 or P19"): moved to
  `app/decks/edit-as-text/list-preview.ts` as `presentListPreview()`. It stays in `app/` because it
  uses `app/decks/labels.ts` (problem, bracket and role text), which modules can't import. The row
  is deleted. It is a move: the mapping is about 20 lines (the row said 70), and the action
  dropped 60.
- **Tests:** `format-rules.test.ts` pins every field for every format (values recorded from the old
  code before replacing it); the old `deckSize`/`roleTargets`/`formatRulesSummary` tests moved there.

**Disagreements between checks (kept both answers; the user decides):**

1. **Copy limit in Casual.** Legality checks and the builder UI say "no limit" (`copyLimit: null`,
   from `rules.ts`); the drafter, packages, mana base and suggestions plan with 4
   (`plannedCopyLimit`). Two fields, both pinned.
2. **Copy limit in Limited.** Rules: none. Packages and the drafter: 99. The mana base: unlimited
   (`Infinity`). Suggestions' fallback: 4. Kept as `buildsFromOwnedPool` plus `plannedCopyLimit`
   (callers still return 99 and `Infinity` as before).
3. **Legality in Limited.** Rules and packages: not checked. The four SQL conditions: checked
   against `legalities->>'limited'`, but Scryfall has no such key, so `coalesce(..., 'legal')`
   accepts everything. `legalityChecked: false` makes them agree; identical today, differs only if
   Scryfall ever adds a `limited` key. Not testable offline (SQL).

**Size (honest):** source 92,917 lines (92,909 before), code lines 79,672 (79,685 before): the
target of −150 to −300 was **missed**. About 460 lines of scattered checks and tables went, but the
table carries 22 documented fields (about 130 lines with comments), plus a 75-line test and the
20-line presenter file that the move created. The result is structural: every format question has
one answer, and the lint keeps it so.

**Not verified:** the four SQL conditions (browse grid, suggestions, search for deck, mana base) run
only in integration tests, which this package didn't run (shared database); and the builder in a
browser. Both are in `deferred-checks.md`.

**For the next packages:** P16 (mana curve) can read `curveGuide` and `optimizerTargetManaValue`
from the table instead of keeping its own. P20: the unused-looking `FormatRuleSet.commandZoneTaxPerCast`
is read by the goldfish cast modifier; keep it.
