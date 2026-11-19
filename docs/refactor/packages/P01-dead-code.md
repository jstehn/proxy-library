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
- The clone baseline is updated (`tsx scripts/clones.ts --update`) and the allowlist sizes shrink
  where files got shorter.

## Re-check the numbers

```bash
for t in $(grep -hoE "export const [a-zA-Z]+ = defineTool" src/app/_llm-tools/tools/*.ts | awk '{print $3}'); do n=$(grep -rlw "$t" src | grep -v '\.test\.' | wc -l); [ "$n" -le 1 ] && echo "$t"; done
```

## Handoff

(empty)
