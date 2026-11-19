# P14. Lands and draft cards from features

- **Branch:** `refactor/P14-lands-drafts` · **Depends on:** P11 · **Parallel with:** P10, P12, P13
- **Audit:** doc 65 D4, F4

## Goal

Land and type checks read `CardFeatures` (replacing P04's stopgap), and the drafts module names
no card in code.

## Touches

Every caller of P04's `cardTypes`, plus `src/modules/drafts/domain/{timers,abilities,auto-pick}.ts`.

## Steps

1. Point `cardTypes` callers at `CardFeatures` faces and types, then delete `cardTypes`.
2. `drafts/domain/timers.ts:177`: replace `name === "Cogwork Librarian"` with a
   `DRAFT_ABILITIES` lookup (`kind: "extraCard"`).
3. Lint: forbid `name === "<literal>"` in `src/modules/**/domain`.

## Done when

- `grep -rn 'name === "' src/modules --include='*.ts' | grep -v test` finds no card names.

## Handoff

(empty)
