# P11. Card features: model and storage (re-scoped by the plan review)

> **Decision 3 answered (2026-11-19), conditional:** first check where card features are used. Many places and deck building: compute at sync and on update. Otherwise: compute on load and cache. Record the finding in the handoff. (Design doc 66, section 0, already records the finding: compute at sync.)
>
> **Re-scoped (plan review, 2026-11-19).** Two changes from the first version: (1) **no faces-and-types recognizer.** P26 keeps `cardTypes` as the pure type-line helper (owner answer D2). (2) **The first recognizer must delete an old function**, and the package adds a **regex-count ratchet**.

- **Branch:** `refactor/P11-card-features` (it already exists and holds design doc 66 and ADR 0027, accepted; merge it first) · **Depends on:** P25, P26, **decision 3 (answered)** · **Parallel with:** none (P12–P14 wait for it)
- **Audit:** doc 65 F4, F9, D12, principle 5; [plan review](../reviews/plan-review/README.md) report [4](../reviews/plan-review/4-domain-engines.md)
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S3](../dedup-playbook.md#s3) (the model and recognizers)
- **Lines:** **+300 to +600, honestly.** The model, the registry, the store and the worker command add code. The first recognizer's deletions pay back part of it; P12–P14 pay back the rest. A package that grows the sizes baseline needs the owner's approval: this is the approved exception, and the handoff states the real number.

## Goal

One pure, versioned function turns a card's text into structured `CardFeatures`, stored once per
oracle card. P12–P14 move each ability onto it, by slices, each deleting its old code.

## Deletes

The first recognizer must delete an old function. Pick **one** of these, whichever has fewer
callers (check with grep, and record the choice):

| What                                                                                                                                                                                               | Where                                                                                | Lines        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------ |
| **Tap-for-mana** detection: the extractor for "T: add {…}" in `decks/domain/mana.ts` and the copy in `decks/domain/castability.ts` (`tapped` and its helpers), once the stored feature serves both | `src/modules/decks/domain/{mana,castability}.ts`                                     | −80 to −150  |
| **Or role tags**: the 14 extractors in `shared/card-search/{tags,primitives}.ts` that become recognizers (read doc 66 section 7 for the mapping)                                                   | `src/shared/card-search/{tags,primitives}.ts` (tags.ts is on the oversize allowlist) | −150 to −300 |

Also deleted here, in the same commit as the recognizer: its old tests (rewritten as the
recognizer's fixture table), its entry on `oversize-allowlist.txt` if the file drops under 500
lines, and the matching row in [removal-list.md](../removal-list.md).

Not deleted here: any other regex. P12–P14 own them.

## Touches

`docs/design/66-card-features.md` and `docs/adr/0027-card-features.md` (from the P11 branch; edit
section 1 and the "How each consumer moves" table), new `src/modules/catalog/domain/features/`,
`catalog/infrastructure/schema.ts` and a migration (decision 3: precompute), `catalog/application/sync.ts`,
`worker/index.ts`, the one consumer the first recognizer replaces, new `scripts/regex-count.ts`
(or an option of `scripts/sizes.ts`) and `docs/refactor/regex-baseline.txt`.
**Avoid** the other consumers (P12–P14) and `src/shared/kernel/card-types.ts` (P26).

## Steps

1. **Merge the design.** `git merge refactor/P11-card-features` into your branch (doc 66 and ADR
   0027, accepted). Then amend them: in doc 66 section 1 and the section 7 table, remove "faces
   and types" from what P11 ships and from the recognizer list (P26 keeps `cardTypes` pure; the
   features carry oracle-text facts only); in ADR 0027 add one line saying so. If a field in
   `CardFeatures` existed only for faces and types, delete it from the type (invariant 7: no
   empty promises).
2. **The model and registry:** `CardFeatures`, `CardFeatureFields`, `RECOGNIZERS`,
   `extractFeatures(card)`, the shared preprocessing (reminder text stripped once, name
   substitution, face joining), `featuresVersion`. Pure, no I/O. Unit tests for the registry
   (every field has one owner; two runs are equal).
3. **The store:** one row per oracle card (doc 66, section 8), a `CardFeatureStore` port with a
   Drizzle adapter and an in-memory fake, wired in `catalog/wiring.ts`.
4. **The worker:** `pnpm worker sync features` backfills and re-runs when `featuresVersion`
   changes; the normal sync updates features for changed cards. Check the sync's run time on the
   dev catalog and record it.
5. **The first recognizer: the one from "Deletes".** In one commit:
   - add the recognizer with a fixture table on real card text (`tests/fixtures/`, the pattern in
     doc 66 section 11);
   - move **every** caller of the old function onto the stored feature;
   - delete the old function, its tests and its allowlist entry.
     The commit's net lines must be ≤ 0 for the recognizer and its callers together (the model's own
     cost is in earlier commits).
6. **The regex-count ratchet.** Add a script (a mode of `scripts/sizes.ts` or a small
   `scripts/regex-count.ts`) that counts regex literals that read oracle text (`/…/` with `.test(`,
   `.match(` or `.replace(` on a variable named like `text`, `oracle`, `lower`) in
   `src/modules/decks/domain`, `src/shared/card-search`, `src/modules/drafts/domain` and
   `src/modules/catalog/domain`, **excluding** `catalog/domain/features/recognizers/`. Start from
   the count today (report 4 says about 130, plus the 154 `.test(`/`.match(` hits a plain grep
   finds; define the count precisely in the script). Save it to `docs/refactor/regex-baseline.txt`.
   `--update` only lowers it. Add it to `scripts/check.sh`. Every P12–P14 slice lowers it.
7. **A lint rule** (doc 66 section 10): a regex literal that tests oracle text is an error outside
   `catalog/domain/features/recognizers/`, except the files named in a sorted
   `NOT_YET_RECOGNIZED` list (each deleted by the slice that moves it). Generate the list from
   today's files; it only shrinks.
8. Document the recognizer test pattern for P12–P14 in doc 66 section 11 (a short example).
9. Run `pnpm check`, `pnpm test:int` (SQL and the migration changed), then `pnpm sizes --update`
   only if the count fell; otherwise get the owner's approval for the higher baseline and record
   it in STATUS's "Decisions made".

## What not to do

- Don't add a faces-and-types recognizer, and don't touch `cardTypes`.
- Don't add a recognizer that has no consumer yet.
- Don't leave the old function as a fallback.
- Don't make recognizers import from `decks`.

## Done when

- Design doc 66 and ADR 0027 are accepted and edited for the re-scope. The features are stored for
  the whole local catalog (`pnpm worker sync features`).
- The first recognizer's old function is gone: `grep` for its name finds nothing outside tests of
  the recognizer.
- `docs/refactor/regex-baseline.txt` exists and `pnpm check` enforces it. The lint rule is on.
- `pnpm check` and `pnpm test:int` are green. The handoff states the finding for decision 3's
  follow-up, the real line change (expect +300 to +600), and which function the first recognizer
  deleted.

## Needs the owner

- Approve the baseline increase (this package is the approved exception to the ratchet; confirm the
  final number in the handoff).

## Handoff

**Branch** `refactor/P11-build` (design doc 66 and ADR 0027 merged first, then re-scoped).

- **Decision 3 finding:** features are read in 23 files including deck building: computed at sync (step 5c of every sync) and stored; a read that finds no row or an old one works the card out on the spot without writing (lazy repair, but read-only: a query does not write).
- **First recognizer: `tap-mana`**, not role tags. Role tags have 16+ callers in 12 files, some in the browser (builder, cuts panel); tap-mana had one consumer (`simulateCastOnCurve`, reached by two reads: `audit` and `mana-base`). Deleted from `decks/domain/mana.ts`: `hasTapManaAbility`, `extractTapManaProduction`, `applyManaDoublers` (its Urza, doubler and "five lands with a board" branches were dead: no caller ever passed a battlefield), `totalMana`, `ManaSourceFacts`, `BASIC_LAND_MANA`; and the inline five-lands regex in `castability.ts`. No old tests existed for them; the recognizer has a fixture table. No allowlist or removal-list rows named them.
- **A2:** old functions vs `extractFeatures` over the 29 fixture cards (`tests/fixtures/features/cards.json`): 0 differences (isSource, amount, requiresFiveLands). Not run over the 33,479 dev cards (not allowed here). Known quirk kept on purpose: the recognizer reads printed text including reminder text, as the old code did (a Powerstone maker counts as a mana source); fixing it is a version bump.
- **Deviations from doc 66:** no `plainText`/reminder stripping/name substitution in P11 (no recognizer needs it, and P13 deletes the five existing copies; shipping one now would be a sixth beside them); no `keywords` on `CardText`; `card_features` has no GIN arrays until P13 writes them; the store port only writes (`textsToCompute`, `save`), reads go through `catalogQueries.cardFeatures`; no golden/version test yet (one recognizer; add it with P12). The old `CardFeatures` type in `ports.ts` was renamed `PrintingTags`.
- **Regex ratchet:** `pnpm regex-count` counts every regex literal and `new RegExp(` in production files of `decks/domain`, `shared/card-search`, `drafts/domain`, `catalog/domain` (not recognizers, tests, or three catalog files that parse sets/EDHREC/rules, not card text). Baseline **128**. `NOT_YET_RECOGNIZED` (12 files) is in `eslint-rules/oracle-text-regex.mjs`.
- **Lines:** production code 75,151 -> 75,382 (+231; below the +300..+600 estimate). The swap itself (recognizer + `withTapMana` + callers - deletions) is about -45.
- **Needs:** run migration 0050, then `pnpm worker sync features` on the dev DB and record its time; owner approves the baseline (`pnpm sizes --update` will not raise it).
