# P11. Card features: model and storage

> **Decision 3 answered (2026-11-19), conditional:** first check where card features are used. Many places and deck building: compute at sync and on update. Otherwise: compute on load and cache. Record the finding in the handoff.

- **Branch:** `refactor/P11-card-features` · **Depends on:** P09, **decision 3** · **Parallel with:** P10
- **Audit:** doc 65 F4, F9, D12, principle 5
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S3](../dedup-playbook.md#s3) (the model and recognizers) · **Lines to remove:** small or positive: the model adds code; P12–P14 remove the copies

## Goal

One pure, versioned function turns a card's text into structured `CardFeatures`, stored (or
cached) once. P12–P14 move each consumer onto it.

## Touches

New `docs/design/66-card-features.md` and `docs/adr/0027-card-features.md`, new
`src/modules/catalog/domain/features/`, `catalog/infrastructure/schema.ts` and a migration (if
decision 3 is "precompute"), `catalog/application/sync.ts`, `worker/index.ts`.
**Avoid** the consumers (P12–P14).

## Steps

1. **Design doc 66** (from `docs/design/TEMPLATE.md`): the `CardFeatures` shape. It has to
   cover: faces and types (replacing P04's helper), mana production, cost changes, cast
   permissions, triggers, role tags, themes, signals. Also the `featuresVersion` rule and how
   recognizers are registered (a list of plugins, each `{ id, recognize(card) }`). Read the
   current recognizers first: `shared/card-search/{tags,primitives,signals}.ts` and
   `decks/domain/{signals,deck-profile,mana,castability,sim-pipeline,rules,token-proxies}.ts`.
   Get the user's approval before any code.
2. **ADR 0027**, extending ADR 0019.
3. Build the model, the recognizer registry, the storage (or cache), and a worker command
   (`pnpm worker sync features`) that backfills and re-runs when the version changes.
4. Ship with the **faces and types** recognizer only, plus fixture tests on real card text in
   `tests/fixtures/`. P12–P14 add the rest.

## Done when

- Design doc 66 and ADR 0027 are accepted. Features are stored (or cached) for the whole local
  catalog. The recognizer test pattern is documented for P12–P14.

## Handoff

(empty)
