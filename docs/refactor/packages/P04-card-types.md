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

(empty)
