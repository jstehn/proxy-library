# P04. One card-type helper (stopgap until P14)

- **Branch:** `refactor/P04-card-types` · **Depends on:** P02, **decision 1** in STATUS ·
  **Parallel with:** P03
- **Audit:** doc 65 D4

## Goal

"Is this card a land / creature / basic?" is answered by one function, with the double-faced card
rule the user chose. P14 later replaces it with `CardFeatures`.

## Touches

`src/modules/catalog/domain/card-types.ts` (new) and `catalog/client.ts`. Callers:
`decks/domain/{stats,castability,mana,playtest-card,draws,goldfish-session,suggest,optimize,cuts,eval,draft-deck,commanders}.ts`,
`decks/queries/suggestions.ts`, `drafts/domain/{auto-pick,suggested-build}.ts`,
`app/drafts/[id]/pool.ts`, `app/decks/[id]/builder/{deck-list,deck-builder,cuts-panel}.tsx`,
`app/_llm-tools/compact-deck.ts`.

## Steps

1. Write the test first: every current land check run on the same cards (a basic, a dual, a
   spell with a land back face, a land with a spell back face, a split card, a token). Record which
   ones disagree.
2. Write `cardTypes(typeLine)`, returning `{ faces: string[][], isLand, isLandOnFront, hasLandFace,
isBasic, isCreature }`, using the rule from decision 1.
3. Replace every check from the command below. Keep `isLandOnFront` vs `hasLandFace` where a caller
   really needs the difference (castability's back-face lands), and name the reason in a comment.
4. Lint: forbid the `/\bLand\b/` regex outside `catalog`.

## Done when

- The command below finds nothing outside `catalog`.

## Re-check the numbers

```bash
grep -rnE '\\bLand\\b|"Land"' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -v modules/catalog
```

## Handoff

Done on `refactor/P04-card-types`; `pnpm check` and `pnpm test:int` (265 tests) pass.

- **Where it lives (differs from the brief).** `src/shared/kernel/card-types.ts`, not
  `catalog/domain/card-types.ts`: a domain may import another module only as a type (ADR 0009), so
  `decks/domain` could not call a catalog function. Exports: `cardTypes(typeLine)` returning
  `{ faces, isLand, isLandOnFront, isBasic, isCreature }`, and the one-answer helpers `isLand`,
  `isBasicLand`, `isCreature`. I dropped `hasLandFace`: `isLand` is exactly "a land on any face"
  (decision 1), so it would be the same value.
- **Rule (decision 1):** `isLand` is true when any face is a land. This changes the deck builder:
  it counted only the front face, so "Instant // Land" cards were spells there; now they count as
  lands in the land count, curve, role and cut logic, opening hands, and the compact deck's
  "Lands" group. The drafter already counted them. Tool reference outputs didn't change (the test
  catalog has no such card in the sampled decks).
- **Where the front face still decides** (comment at each): `castability.ts` (a back-face land is
  a spell until turned over, and enters tapped) and `card-search/tags.ts` (a spell with a land back
  is tagged as the spell). Both use `isLandOnFront`.
- Before: seven different land checks (front-face regex in `stats`, `card-search/primitives`
  and `compact-deck`; whole-line regex in the drafter, `mana.ts`, `pool.ts` and the tools; "any
  face" in `playtest-card`; front plus back in `castability`). The new test in
  `kernel/card-types.test.ts` covers a basic, snow basic, dual, artifact land, creature land,
  both MDFC directions, a split card, a transforming creature, a token and a "Landon" trap.
- `decks/domain/stats.ts` still exports `isLand` (a re-export of the kernel's) so its 15 callers
  and `decks/client.ts` didn't need to change. The old test in `stats.test.ts` that asserted
  "Instant // Land" is not a land now asserts the opposite.
- `isCreatureLine` in `drafts/domain/abilities.ts` is the kernel's `isCreature`, re-exported.
- Lint: a `no-restricted-syntax` selector forbids the regex literals `/\bLand\b/`, `/\bCreature\b/`
  and `/\bBasic\b/` outside the catalog and kernel schemas. The brief's grep still finds the
  type words in lists (`TYPE_ORDER`, `hasType("Land")` in card-search SQL, `mainType`, the
  signals list); those are vocabulary, not checks, so I left them. `card-search/sql.ts`
  `hasType("Land")` already tests the whole type line, which matches the rule.
- Left alone: `mainType` still returns the first type in `TYPE_ORDER` ("Artifact Land" is an
  Artifact in the type breakdown). Only the deck list's land section now uses `isLand`.
- Source lines: 90,973 before, 91,012 after (+39: the kernel file is new, the regexes it replaces are short). Clone baseline unchanged (57).
