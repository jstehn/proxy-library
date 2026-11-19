# P13. Tags, themes and signals

- **Branch:** `refactor/P13-tags-signals` · **Depends on:** P11 · **Parallel with:** P10, P12, P14
- **Audit:** doc 65 F4, F9, D12

## Goal

Role tags, themes and signals come from `CardFeatures`. The two signals systems become one, and
`shared/card-search` goes back to being just the search language and its SQL (ADR 0017).

## Touches

`src/shared/card-search/{tags,primitives,signals,brackets}.ts` (moved out),
`src/modules/decks/domain/{signals,deck-profile,rate,suggest}.ts`, the worker's tag-cards command
(`pnpm worker tag-cards`), and new recognizers in `catalog/domain/features/`. **Avoid**
`sim-pipeline` (P12).

## Steps

1. Compare `shared/card-search/signals.ts` (deck-level evidence) and `decks/domain/signals.ts`
   (produces and consumes). Design one signals model that covers both, and note in the handoff
   what changed.
2. Move tag, theme and signal recognition into feature recognizers. The search language's
   `tag:` and `theme:` filters read the stored features.
3. Remove both `withoutReminders` copies (reminder text is stripped once, in the features
   pipeline).
4. `shared/card-search` keeps `parse.ts`, `sql.ts`, `list.ts` and `help.ts` only.

## Done when

- `ls src/shared/card-search` shows only the search language. There's one `signals` module.

## Handoff

(empty)
