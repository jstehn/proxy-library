# P12. Mana and casting from features

- **Branch:** `refactor/P12-mana-casting` · **Depends on:** P11 · **Parallel with:** P10, P13, P14
- **Audit:** doc 65 F4, D12

## Goal

The goldfish simulator and castability read mana production, cost changes and cast permissions
from `CardFeatures`, not from regexes over the text.

## Touches

`src/modules/decks/domain/{sim-pipeline,mana,castability,goldfish-session}.ts`, and new
recognizers in `catalog/domain/features/`. **Avoid** `shared/card-search` (P13) and land
detection (P14).

## Steps

1. For each regex in `sim-pipeline.ts` (21), `mana.ts` and `castability.ts`, write a recognizer
   with fixture tests, using the same cards the current tests use.
2. Change each plugin's `applies` to match on features (for example
   `feature.castPermission.kind === "permanentFromGraveyardEachType"`), not on text.
3. Delete the text parsing. The plugins stay plugins.
4. Split `sim-pipeline.ts` (778 lines) into one file per plugin kind (cast modifiers, zone
   permissions, triggers, activated abilities), each under 500 lines.

## Done when

- `grep -cE '/i\.test\(' src/modules/decks/domain/{sim-pipeline,mana,castability}.ts` is 0.
- The simulator tests pass (rewritten where they tested text parsing).

## Handoff

(empty)
