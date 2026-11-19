# P10. Formats as a strategy table

- **Branch:** `refactor/P10-formats` · **Depends on:** P09 · **Parallel with:** P11–P14
- **Audit:** doc 65 F3, D14
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S6](../dedup-playbook.md#s6) · **Lines to remove:** about −150 to −300

## Goal

Only `format-rules.ts` knows how formats differ. Everything else asks a question
(`rules.hasCommandZone`), so adding a format is a compile error until every rule is filled in.

## Touches

`src/modules/decks/domain/format-rules.ts`, and every file with a `format === "…"` check
(command below). Today that's mostly `decks/domain/{stats,packages,draft-deck,rules,rate}.ts`,
`decks/queries/*`, `decks/application/*`, the bindings, and `app/decks/[id]/builder/*`.
**Avoid** anything that parses oracle text (P11–P14).

## Steps

1. Group the checks by the question they ask: deck size, copy limit, command zone, color
   identity, brackets apply, sideboard size, opening hand, curve guide, suggestion knobs.
2. Add each as a field of `FormatRuleSet`. Define `FORMAT_RULES` as
   `{…} satisfies Record<Format, FormatRuleSet>`, and a `formatRules(format)` lookup.
3. Replace every check. Client code gets the rules from `decks/client.ts`.
4. Lint: forbid `format === "<literal>"` and `format !== "<literal>"` outside `format-rules.ts`.

## Done when

- The command below finds nothing outside `format-rules.ts` and tests.

## Re-check the numbers

```bash
grep -rnE 'format (===|!==) "' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -v format-rules.ts
```

## Handoff

(empty)
