# P21. Naming sweep and docs

- **Branch:** `refactor/P21-naming-docs` · **Depends on:** P18 · **Parallel with:** P20 (one module per commit, so conflicts stay small)
- **Audit:** doc 65 F10, section 4.3 (the "where does this live?" table) · **Ends wave 5 → milestone 3**

## Goal

The code follows its own conventions again, and the docs describe the new architecture.

## Touches

Any file using `ctx`, `res`, `obj`, `val` or `tl` (command below), `docs/architecture/*.md`,
`docs/README.md`, `docs/decisions-to-review.md`.

## Steps

1. Rename the abbreviations, one module per commit.
2. `conventions.md`: add the "where does this live?" table (one row per duplication group in doc
   65 section 4.1, pointing to its home now), the 500-line benchmark, and the adapter rules from
   ADR 0026.
3. `patterns.md`: use the sim pipeline, `FORMAT_RULES`, card features and bindings as the worked
   examples.
4. `overview.md`: check P18's module table and graph, and the request walkthrough (it should show
   a capability and two adapters).
5. Move `decisions-to-review.md` into `docs/archive/`.
6. Milestone 3: tick every row in `reference/features.md`, run the full suite, and ask the user
   about merging into `main`.

## Re-check the numbers

```bash
for w in ctx res obj val tl; do printf "%s %s\n" $w $(grep -rwE "$w" src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l); done
```

## Handoff

(empty)
