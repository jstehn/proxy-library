# Review after milestone 1 (wave 2)

2026-11-19, on `refactor/main` at `ec8d171`. `pnpm check` is green, and the Playwright suite passed
26 of 26 after P09.

## What went well

- **Every LLM tool is a binding over a capability.** The `tools/` folder and the old registry are
  gone, each module has its own `describe-error`, and `_llm-tools/` shrank from 5,924 to 3,956 lines.
- **Clone runs fell from 57 to 36,** and files over 500 lines from 27 to 23.
- **The handoffs are honest.** P09's "Size (honest)" paragraph names the net growth and says why.
- The milestone ran with deferred checks, a browser look and e2e, and `main` was merged with your
  approval.

## What didn't: half of S1 was collected

The playbook's biggest saving (S1, −3,000 to −4,000) is "one capability, many callers". Wave 2 built
the capabilities and moved **one** caller, the tools, onto them. The UI still reaches the old query
paths on its own.

| Measure (since P05 started)        | Before | Now    | Target                       |
| ---------------------------------- | ------ | ------ | ---------------------------- |
| `src/app/_llm-tools`               | 5,924  | 3,956  | ≤ 2,500                      |
| `src/modules` (capabilities added) | 52,907 | 55,986 |                              |
| `src/server` (`capabilities.ts`)   | 429    | 785    |                              |
| `builder/actions.ts`               | 842    | 756    | ≤ 350                        |
| `app/decks/actions.ts`             | —      | 383    | ≤ 200                        |
| `getContainer()` in `src/app`      | 191    | 191    | one per file, via `action()` |
| Callers of `action()`              | 0      | 0      | every server action          |

Net: source lines grew by about 900 over wave 2, where the plan expected about −3,000. The growth is
not waste. It's the new path sitting beside the old one, and the deletion only comes when the second
caller moves.

## Findings

1. **No package owns moving the UI onto capabilities.** The handoffs for P06, P08 and P09 each say
   "P19 does that", but P19's package file never mentions `action()` or `getContainer()`. P19 only
   covers `builder/`, and 29 other action files (122 calls) plus 45 pages (51 calls) belong to no
   package at all.
2. **The adapter lint rule has a hole.** It bans importing `@/shared/db`, but an action can still
   write `getContainer().db` and pass it to a query function exported from a module's `index.ts`.
   26 files in `src/app` do this. Pages and routes are not covered at all.
3. **`decks/index.ts` is 512 lines with 96 exports,** because it exports the db-taking queries the UI
   calls. Each caller that moves lets one export go.
4. **`capabilities.ts` will pass 500 lines** once the UI's reads join it. It already repeats the same
   `deckView` lambda 5 times and the `profile` lambda 6 times.
5. **Deferrals were not written into the package they were deferred to.** That's how finding 1
   happened.

## Options to consider

**Chosen (2026-11-19): A.** It became wave 2½: [P09b](../packages/P09b-wiring-and-builder.md), [P09c](../packages/P09c-deck-callers.md) and [P09d](../packages/P09d-other-callers.md). The fixes for findings 4 and 5 are in P09b and the README.

- **A. A new package before wave 3: "UI callers onto capabilities".** Every server action goes
  through `action()`, and pages read through capabilities. Old query exports leave `decks/index.ts`
  as their last caller moves. The lint rule also bans `getContainer().db` in `src/app`, with a
  ratchet (`pnpm sizes` already prints the count). It could be split by area:
  - builder actions (leaving P19 only the UI split)
  - decks, drafts and collection
  - the rest

  Doing it **before** wave 3 means P10–P14, which change what those queries compute, change one
  caller instead of two.

- **B. Leave it for P19 and wave 5,** but write it into P19 (and P20 for the non-deck pages). This is
  cheaper now, but the old and new paths drift through waves 3–4, and the savings estimates for
  P10–P17 assume one path.
- **For finding 4, either option:** give each module a `capabilities.ts` wiring function
  (`makeDeckCapabilities({ db, clock, … })`). The composition root then only joins them, and a shared
  `deckReads` object replaces the repeated lambdas.
- **For finding 5:** in the README's "Ending a session", a deferral must edit the receiving
  package's file (Steps and Done when) in the same commit. "Package X does that" in a handoff is not
  enough.
