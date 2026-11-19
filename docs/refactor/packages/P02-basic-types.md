# P02. One set of basic types; money

- **Branch:** `refactor/P02-basic-types` · **Depends on:** P01 · **Parallel with:** none (touches
  files everywhere)
- **Audit:** doc 65 F5, D6, D7, section 4.2 (how to merge)

## Goal

Each basic word has one type, one `as const` array and one Zod schema, and money is always shown
with `Cents.format`.

## Touches

`src/modules/catalog/domain/types.ts`, `src/modules/catalog/client.ts` (create if missing),
`src/shared/db/`, `src/shared/kernel/` (Cents), every `schema.ts`, and every file the commands
below list.

## Steps

1. In `catalog/domain/types.ts`, make `FINISHES`, `RARITIES`, `COLORS` `as const` arrays, with the
   types derived from them and `FinishSchema`/`RaritySchema`/`ColorSchema = z.enum(ARRAY)` next to
   them. Add `ManaSymbol` (colors plus `C`). Export everything from `catalog/client.ts` (browser
   safe) and `catalog/index.ts`.
2. Replace the 20 inline `"nonfoil" | "foil" | "etched"` unions, the 18 inline `z.enum`s, the 11
   local `FinishSchema`s, the 8 `ColorSchema`s, the `RaritySchema`/`StatusSchema` copies, the 15
   color arrays, and both `ManaColor`/`MANA_COLORS` pairs in `decks/domain` (`mana.ts`,
   `stats.ts`, `mana-symbols.ts`).
3. Rename the two `DeckProfile`s: `domain/deck-profile.ts` → `DeckPlan` (key cards, avoid
   cards); `domain/suggest.ts` → `DeckFingerprint`. Drop the `as DeckPlanProfile` aliases.
4. Move the `timestamptz` custom column type (in all 11 `schema.ts` files) and the `cents` column
   type (3 files) into `src/shared/db/columns.ts`.
5. Use `isPlayed(board)` instead of the 3 inline `board === "main" || board === "commander"`.
6. Money: replace the 5 hand-written `(cents / 100).toFixed(2)`, the 3 `dollars()` and the 2
   `money()` helpers with `Cents.format`. Add `Cents.formatOrDash(cents | null)` if "no price"
   needs it.
7. Add lint rules (`no-restricted-syntax`, with messages naming the right import): no inline
   `z.enum` of finishes or colors outside `catalog`, and no `/ 100).toFixed(` outside `Cents`.

## Done when

- The commands below find nothing outside `catalog` and `shared`.
- The lint rules pass with zero exceptions. The clone baseline is lowered.

## Re-check the numbers

```bash
grep -rnE '"nonfoil" \| "foil" \| "etched"|z\.enum\(\["(nonfoil|W)"' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -v modules/catalog
grep -rnE 'const (FinishSchema|ColorSchema|RaritySchema|COLORS|ALL_COLORS|MANA_COLORS|COLOR_ORDER) ' src | grep -v '\.test\.'
grep -rnE 'toFixed\(2\)' src | grep -E '/ ?100' | grep -v shared/kernel
```

## Handoff

(empty)
