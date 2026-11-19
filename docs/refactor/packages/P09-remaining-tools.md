# P09. Remaining tools and error text

- **Branch:** `refactor/P09-remaining-tools` · **Depends on:** P06, P07, P08 · **Parallel with:** none
- **Audit:** doc 65 F2, F7, D8 · **Ends wave 2 → milestone 1**
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S1](../dedup-playbook.md#s1) (remaining rows) and [S7](../dedup-playbook.md#s7) · **Lines to remove:** about −800 to −1,200

## Goal

Every tool is a binding, the old `tools/` folder is gone, and every server action turns errors
into text through its module's `describe…Error`.

## Touches

`src/app/_llm-tools/` (all), bindings `edhrec_lookup`, `find_combos`, `draw_sample`,
`rules_lookup`, `youtube_research`, `reddit_research`, `get_account` (if not done in P05). The
server actions with their own `messageFor`: `app/account/password`, `app/admin/{players,photos,economy}`,
`app/wallet`, `app/store`, `app/(auth)/{register,sign-in}`, `app/trades`. Each of those modules'
`application/describe-error.ts`.

## Steps

1. Capabilities plus bindings for the remaining tools. `draw_sample` uses the existing
   `decks` simulator functions as they are; P15 merges them later.
2. Delete `src/app/_llm-tools/tools/` and the old registry fallback. Remove `consolidated.ts`.
3. One `describe<Module>Error` per module with `assertNever`. Replace the 9 `messageFor`
   functions.
4. Remove the old tests for deleted code. Check every tool against
   `docs/refactor/reference/tools/` and write down every intended difference in the handoff.
5. Milestone 1 check: tick the LLM tool and builder rows in `reference/features.md`, run the full
   suite, and ask the user about merging `refactor/main` into `main`.

## Done when

- `src/app/_llm-tools/` has only transports, `binding.ts`, `registry.ts` and `bindings/`. No file
  there is over 500 lines.
- `grep -rn "function messageFor\|messages: Record<string, string>" src/app` finds nothing.

## Handoff

(empty)
