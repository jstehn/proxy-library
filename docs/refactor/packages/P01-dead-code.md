# P01. Delete dead code

- **Branch:** `refactor/P01-dead-code` · **Depends on:** P00 · **Parallel with:** none
- **Audit:** doc 65 F2 (evidence), D13

## Goal

Remove code nothing can reach, so later packages don't move or test it.

## Touches

`src/app/_llm-tools/tools/*.ts`, plus whatever `knip` reports.

## Steps

1. Delete the 27 tool definitions that only their own file references. Find them with the
   command below. Keep the domain and query code they call; the UI still uses most of it.
2. Run `knip` (add it as a dev dependency, or `pnpm dlx knip` with the user's OK) for unused
   files and exports. Delete the real ones. Leave anything used only by tests or scripts if it's
   still wanted, and note it in the handoff.
3. Remove deleted names from `index.ts` files.
4. Record the line counts before and after in the handoff.

## Done when

- None of the 27 names appear in `src/`.
- The clone baseline is updated (`tsx scripts/dev/clones.ts --update`) and the allowlist sizes shrink
  where files got shorter.

## Re-check the numbers

```bash
for t in $(grep -hoE "export const [a-zA-Z]+ = defineTool" src/app/_llm-tools/tools/*.ts | awk '{print $3}'); do n=$(grep -rlw "$t" src | grep -v '\.test\.' | wc -l); [ "$n" -le 1 ] && echo "$t"; done
```

## Handoff

Done on `refactor/P01-dead-code`.

- Step 1: the 27 unregistered tool definitions are deleted, with the imports and helpers only they
  used (the domain and query code they called stays where something else uses it).
- Step 2: `knip` is a dev dependency (`pnpm knip`, config in `knip.json`). Its unused files were
  false positives (`public/sw.js` is registered by string, `mana-font` is read by path,
  `scripts/dev/eval-ratings.ts` is a tool you run by hand), so they're in the config. I ran
  `knip --fix --fix-type exports` (357 unused exports lose the `export` keyword), then deleted what
  that left unused. Unused exported **types** (729) are left alone: exporting a type does no harm.
- Ten exports remain that knip flags, because a type uses them through `typeof` (the lint rule
  cannot see that): `COUNTED_BOARDS`, the `BRACKET_*` tables, `FIXED_CARD_ROLE_TAGS`,
  `SIGNAL_TAGS`, `TOKEN_KINDS`, and a few others. Later packages that touch those files can drop
  the `export`.
- Source lines: 93,743 before, 91,061 after. Clone baseline 63 to 58. `decks/index.ts` is no
  longer over 500 lines (off the allowlist). Integration and e2e tests not run: the changes only
  delete code and `export` keywords, and `pnpm check` passes.
