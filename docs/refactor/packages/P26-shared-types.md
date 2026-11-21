# P26. Shared card and row types

- **Branch:** `refactor/P26-shared-types` · **Depends on:** P23 · **Parallel with:** P24, P25 (the second to merge resolves conflicts)
- **Source:** [plan review](../reviews/plan-review/README.md) (P26), reports [2](../reviews/plan-review/2-code-volume.md) and [4](../reviews/plan-review/4-domain-engines.md)
- **Lines:** −300 to −500. Cheaper now than after P18 moves files.

## Why

About 8,600 lines are type declarations. `typeLine: string` is declared again in about 51 places
(a plain grep for property lines finds 31 outside tests; the rest are inline or multi-line forms).
Every module restates `{ name, typeLine, manaValue, … }` a little differently. A few base types
with `Pick` and `Omit` remove the copies, and leave one place to change when a field changes.

**P26 keeps `cardTypes` as a pure type-line helper** (`src/shared/kernel/card-types.ts`; owner
answer D2). It does not move into the card-features model (P11).

## Deletes

| What                                                                                                                                                                      | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Lines        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Copies of the card-face fields (`name`, `typeLine`, `manaCost`, `manaValue`, `colors`, `oracleText`, …)                                                                   | about 51 declarations: among others `decks/domain/{suggestion-types,deck-view,browse-card,stats,rate,rules,castability,mana,mana-base,draws,deck-profile,signals,commanders,brackets,search-for-deck,playtest-card,draft-deck}.ts`, `drafts/domain/auto-pick.ts`, `catalog/domain/types.ts`, `catalog/application/{ports,card-lookup}.ts`, `catalog/queries/catalog.ts`, `shared/card-search/{signals,primitives}.ts`, `app/_llm-tools/present/compact-deck.ts` | −200 to −350 |
| Copies of the deck-line shape (`{ oracleId, quantity, board, … }` plus card fields)                                                                                       | the same folders; find with `grep -rn "quantity: number" src --include='*.ts'`                                                                                                                                                                                                                                                                                                                                                                                  | −100 to −150 |
| The 83 raw `/\bLegendary\b/.test(typeLine)`-style checks outside the kernel (grep for `Legendary`, `Creature`, `Land`, `Artifact` inside `.test(`; the report counted 83) | `decks/domain/*`, `shared/card-search/*`, drafts                                                                                                                                                                                                                                                                                                                                                                                                                | −20 to −80   |

## Touches

New `src/shared/kernel/card-shapes.ts` (or the folder the design below names), the files in the
table, `src/shared/kernel/card-types.ts` and its test, `src/shared/kernel/index.ts`.
**Avoid** moving files (P18, P30) and the oracle-text regexes (P11–P14): this package replaces only
**type-line** checks.

## Steps

1. **List the shapes.** Run `grep -rnE "typeLine\??:" src --include='*.ts' --include='*.tsx' | grep -v "\.test\."`.
   For each hit, write down the other fields declared beside it. Group into at most five base
   types. Likely: `CardFace` (name, typeLine, manaCost, manaValue, colors, colorIdentity,
   oracleText), `CardPrint` (printing id, set, collector number, finishes, image), `DeckLine`
   (a card, quantity, board), `PricedLine` (a line with a price). Write the groups into the file's
   header comment; the base types are small and named in full words.
2. **Add the base types** in `src/shared/kernel` (they are Magic vocabulary like `card-types`).
   Pure types only, no logic.
3. **Replace the copies, one module per commit.** Where a file needs fewer fields, use
   `Pick<CardFace, "name" | "typeLine">`. Where it adds fields, use `CardFace & { … }`. **In the same
   commit, delete the old declaration.** Don't leave an alias beside the new type.
4. **Type-line checks.** Replace each raw type-line regex with `cardTypes(typeLine)` or the helpers
   `isLand`, `isCreature`, `isBasicLand`. If a check needs a type the helper lacks (Legendary,
   Planeswalker, Artifact, Enchantment, Battle), add it to `CardTypes` once, with a test. This is
   the only place that reads a type line.
5. **Lint.** Add a `no-restricted-syntax` rule: a regex literal containing `\bLegendary\b`,
   `\bCreature\b`, `\bLand\b`, `\bPlaneswalker\b` outside `src/shared/kernel/card-types.ts` is an
   error ("use cardTypes()"). Tests are exempt.
6. Run `pnpm typecheck` after each module. Run `pnpm check` at the end, then
   `pnpm sizes --update`.

## What not to do

- Don't change a field's meaning. If two copies differ (nullable vs not), keep the stricter one
  only if every caller already passes it; otherwise keep a `Omit<…> & { … }` and say so.
- Don't touch oracle-text regexes. They go to P11–P14.
- Don't rename fields. Don't add a new layer of "view" types.

## Done when

- `grep -rnE "^\s*typeLine\??: " src --include='*.ts' --include='*.tsx' | grep -v "\.test\."` finds
  only the base types (and the database schema).
- `grep -rnE "/[^/]*\\\\b(Legendary|Creature|Land|Planeswalker)\\\\b[^/]*/\.test\(" src | grep -v test`
  finds nothing outside the kernel (adjust the pattern; it must match how the code writes them).
- `pnpm check` is green. The sizes baseline is lowered. The handoff lists the base types, the
  number of declarations replaced, and the lines removed.

## Handoff

- **Base types** (`src/shared/kernel/card-shapes.ts`, exported from the kernel): `CardFacts`
  (name, typeLine, manaCost, manaValue, text, producedMana) and `CardIdentity` (oracleId,
  printingId). `DeckCount` ({ quantity, board }) lives in `decks/domain/boards.ts` because `Board`
  is a decks word; the browser gets it from `decks/client`.
- **Replaced:** 35 hand-written shapes now use `Pick<CardFacts, …>` / `CardIdentity` / `DeckCount`
  (catalog `Printing`, `CardFace`, `FoundCard`, `TaggablePrinting`, `CardTextToEmbed`; decks
  `DeckLine`, `BrowseCard`, `FoundCard`, `CardRules`, `DraftedSpell`, `BracketSource`,
  `CandidateCard`, `RatingCandidate`, `StatsLine`, `CastabilityLine`, `LandCandidate`,
  `CommanderCandidate`, `DrawLine`, `SignalCardInput`, `ManaSourceFacts`, `PrintedFace`,
  `CardReference`, `SampleCard`, …; `TagFacts`, `SignalCard`, `CurveLine`, `FaceFacts`,
  `CompactLineSource`). `BoardCount` (free-copies) is gone: it was `DeckCount`.
- **Type-line checks:** new `hasTypeWord(typeLine, words, frontOnly?)` in `card-types.ts` (tested).
  About 40 raw regexes now call it (tags, rules, suggest, both signals files, deck-profile, stats
  `mainType`, compact-deck, budget-replacements, drafts abilities). Lint rule `TYPE_LINE_WORDS`
  bans `\bLegendary|Creature|Land|Planeswalker\b` regex literals outside tests.
- **Kept as they were:** Kindred/Tribal still count as creature types (suggest, card-search
  signals use `hasTypeWord(types, ["Creature", "Kindred", "Tribal"])`, not `isCreature`).
  `deck-profile` (artifact, enchantment, instant/sorcery) and budget-replacements used `/i`
  regexes; `hasTypeWord` is case-sensitive. Scryfall type lines are always capitalised, so no
  real card changes, but it is a difference. `token-proxies.ts` (`/\bemblem\b/i`) and the Urza
  land names in `mana.ts` were left alone.
- **Skipped (P24 deletes them):** `goldfish-types.ts`, `goldfish-session.ts`, `sim-pipeline.ts`.
- Not done: the other deck-line shapes (`{ oracleId, board, quantity }` in preview, builder-state,
  list-format) and the row types inside SQL queries; each would save about one line.
- Production code lines 77318 to 77313 (baseline lowered). The `Pick` form needs more lines than
  a short copy once Prettier wraps it, so the saving is mostly in the long ones.
