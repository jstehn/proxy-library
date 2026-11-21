# P09. Remaining tools and error text

- **Branch:** `refactor/P09-remaining-tools` · **Depends on:** P06, P07a–d, P07b2, P08 · **Parallel with:** none
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

**Done:**

- **Every tool is a binding** (16 of them). New this package: `edhrec_lookup`, `find_combos`,
  `draw_sample`, `rules_lookup`, `youtube_research`, `reddit_research`. `src/app/_llm-tools/tools/`
  is deleted, and so are `avoid-cards.ts` and the legacy list in `registry.ts` (`TOOLS` is `BINDINGS`).
- **New capabilities:** `edhrec` (`forCommander`, `compareDeck`), `deckCombos`, `drawSample` (all in
  `decks/application/`), `rulesLookup` (`catalog/application/rules-lookup.ts`: `rulingsForCard`,
  `interactionsOf`, `searchRules`), and `youtube` and `reddit`, which are the existing services passed
  through (`capabilities.youtube`, `capabilities.reddit`). Outside-service readers (EDHREC, Spellbook,
  Scryfall rulings) are injected from `core.ts`; each has fake-reader unit tests.
- **Moved to fit the layers:** `related-rules.ts` (with its test) into `catalog/domain/`; the outside-data
  result types into `catalog/domain/outside-data.ts`; `OwnedCardCheck` into `decks/domain/`;
  `LookupRulesResult` into `catalog/domain/rules-search.ts`; `compact-deck.ts` into `present/`.
- **S7, error text:** the nine `messageFor` functions are gone. Each lives in its module's
  `application/describe-error.ts` (accounts: change password, sign in, register, player actions;
  wallet: add own funds, correct balance, economy settings; store: buy sealed; catalog: photo
  and page slug), exhaustive with `assertNever`, with tests for the ones with numbers in them.
  `grep -rn "function messageFor" src/app` finds nothing.
- **Checked:** `pnpm check` green, 281 of 281 integration tests. The three non-network tools in
  the reference set (`draw_sample`, `rules_lookup`, plus the P08 ones) regenerate unchanged apart
  from run-order noise and `draw_sample`'s time-based seed. One input description I had changed
  (`find_combos` `deckId`) was put back to the old wording.

**Intended differences:** none in what the tools return or accept. `draw_sample`'s too-small-deck
message now builds its number from the capability (`at least 7`) and says the same thing.

**Not verified:** `edhrec_lookup`, `find_combos`, `rules_lookup` rulings, `youtube_research` and
`reddit_research` were never run against their real services (tests don't use the network). They are
checked against fakes only; the real calls are in `deferred-checks.md`.

**Size (honest):** source 92,251 lines, up 364 on P08, and 893 above "After P04" (91,358). The old
tools shed about 930 lines here; the six bindings, five capabilities, two presenters and the
describe-error files added about 1,300. The playbook hoped for −800 to −1,200 for P09. Wave 2 as a
whole is net growth: the framework and every capability were built beside the old code, and the
deletion that pays for it (the builder's `getContainer()` calls, still 191, the duplicate
queries behind the capabilities, the parallel curve and hand engines) is in P15–P19. The one-to-one
copies of the tools' input schemas (kept word for word because the model was tuned on them) are a
fixed cost. Worth deciding with decision 6 whether ≤ 80,000 is still the target.

**Not done:** the builder's server actions still call `getContainer()` directly rather than through
`action()`; P19 does that. `_llm-tools/` also keeps `cap-response.ts`, `cookbook.ts`, `tool.ts` and
`present/` beside the transports and `bindings/` (the "done when" listed fewer files); they are the
response cap, the MCP prompt text, the tool type, and the presenters, all small and in use.

## Milestone 1 check

Wave 2 is built. The milestone merge into `main` waits on the checks in `deferred-checks.md` (the
Playwright suite and a look at the builder in the browser, dark mode and phone width, which have not
run since P05) and on your approval.
