# Refactor status

> Read [README.md](README.md) first. Update this file at the start and end of every session (on
> `refactor/main`). Statuses: **free**, **in progress (session name)**, **done**, **blocked
> (reason)**.

## Packages

Waves run in order. Inside a wave, packages marked parallel can run at the same time, each in
its own worktree.

| Id    | Package                                                                                  | Depends on              | Parallel with               | Status                     |
| ----- | ---------------------------------------------------------------------------------------- | ----------------------- | --------------------------- | -------------------------- |
|       | **Wave 0: set up**                                                                       |                         |                             |                            |
| P00   | [Set up the refactor](packages/P00-setup.md)                                             | none                    | none                        | done                       |
| P01   | [Delete dead code](packages/P01-dead-code.md)                                            | P00                     | none                        | done                       |
|       | **Wave 1: the basics** (audit R2)                                                        |                         |                             |                            |
| P02   | [One set of basic types; money](packages/P02-basic-types.md)                             | P01                     | none                        | done                       |
| P03   | [One current-price query](packages/P03-current-price.md)                                 | P02                     | P04                         | done                       |
| P04   | [One card-type helper](packages/P04-card-types.md)                                       | P02, decision 1         | P03                         | done                       |
|       | **Wave 2: capabilities and adapters** (audit R3) · milestone 1                           |                         |                             |                            |
| P05   | [Capability and binding framework](packages/P05-framework.md)                            | P03, P04                | none                        | done                       |
| P06   | [Deck read capabilities](packages/P06-deck-reads.md)                                     | P05                     | P07, P08                    | done                       |
| P07a  | [Shared SQL pieces: text arrays, store offers](packages/P07-candidates.md)               | P05                     | P06, P08                    | done                       |
| P07b  | [Candidate pool (SQL)](packages/P07b-candidate-pool.md)                                  | P07a                    | P08                         | done                       |
| P07b2 | [Suggestion service](packages/P07b2-suggestion-service.md)                               | P07b                    | P08                         | done                       |
| P07c  | [Card and wishlist tools as bindings](packages/P07c-library-tools.md)                    | P07a                    | P08                         | done                       |
| P07d  | [search_cards as a binding](packages/P07d-search-cards.md)                               | P07b, P07c              | P08                         | done                       |
| P08   | [Deck edits and previews](packages/P08-edits-previews.md)                                | P05                     | P06, P07                    | done                       |
| P09   | [Remaining tools and error text](packages/P09-remaining-tools.md)                        | P06, P07a–d, P07b2, P08 | none                        | done                       |
|       | **Wave 2½: UI callers onto capabilities** ([milestone 1 review](reviews/milestone-1.md)) |                         |                             |                            |
| P09b  | [Capability wiring per module; builder actions](packages/P09b-wiring-and-builder.md)     | P09                     | none                        | done                       |
| P09c  | [Deck, draft and collection callers](packages/P09c-deck-callers.md)                      | P09b                    | P09d                        | done                       |
| P09d  | [The other callers](packages/P09d-other-callers.md)                                      | P09b                    | P09c, wave 3                | done                       |
|       | **Wave 3: rules as data** (audit R4, R5)                                                 |                         |                             |                            |
| P10   | [Formats as a strategy table](packages/P10-formats.md)                                   | P09c                    | P11–P14                     | free                       |
| P11   | [Card features: model and storage](packages/P11-card-features.md)                        | P09c, decision 3        | P10                         | free (decision 3 answered) |
| P12   | [Mana and casting from features](packages/P12-mana-casting.md)                           | P11                     | P10, P13, P14               | free                       |
| P13   | [Tags, themes and signals](packages/P13-tags-signals.md)                                 | P11                     | P10, P12, P14               | free                       |
| P14   | [Lands and draft cards from features](packages/P14-lands-drafts.md)                      | P11                     | P10, P12, P13               | free                       |
|       | **Wave 4: merge parallel implementations** (audit R6) · milestone 2                      |                         |                             |                            |
| P15   | [One opening-hand engine](packages/P15-opening-hands.md)                                 | P12, P14                | P16, P17                    | free                       |
| P16   | [One mana curve](packages/P16-mana-curve.md)                                             | P10, decision 2         | P15, P17                    | free (decision 2 answered) |
| P17   | [One way to show a collection](packages/P17-collections.md)                              | P09c                    | P15, P16                    | free                       |
|       | **Wave 5: structure** (audit R7–R9) · milestone 3 (final)                                |                         |                             |                            |
| P18   | [Split `decks` by responsibility](packages/P18-split-decks.md)                           | P10–P17, decision 4     | none                        | free (decision 4 answered) |
| P19   | [Break up the deck builder UI](packages/P19-builder-ui.md)                               | P09b                    | any of waves 3–4 except P16 | free                       |
| P20   | [Responsibility check for other modules; large files](packages/P20-large-files.md)       | P18                     | P21                         | free                       |
| P21   | [Naming sweep and docs](packages/P21-naming-docs.md)                                     | P18                     | P20                         | free                       |
| P22   | [Review and consolidate the design docs](packages/P22-design-docs.md)                    | P18                     | P20, P21                    | free                       |

```mermaid
flowchart LR
  P00 --> P01 --> P02 --> P03 & P04
  P03 & P04 --> P05 --> P06 & P07a & P08 --> P09
  P07a --> P07b & P07c --> P09
  P09 --> P09b --> P09c & P09d
  P09b --> P19
  P09c --> P10 & P11 & P17
  P11 --> P12 & P13 & P14
  P12 & P14 --> P15
  P10 --> P16
  P10 & P13 & P15 & P16 & P17 --> P18 --> P20 & P21 & P22
```

## Size tracking

P00's `pnpm sizes` prints these. Add a row when each wave merges. Targets are from doc 65, "The end
state".

| After         | Source lines                         | Test lines | Files > 500 | Biggest folder | Clone runs | `getContainer()` in app          |
| ------------- | ------------------------------------ | ---------- | ----------- | -------------- | ---------- | -------------------------------- |
| Baseline      | 93,361                               | 32,194     | 28          | 43             | 83         | 191                              |
| P00 script    | 93,490 \*                            | 33,860     | 28          | 43             | 63 \*\*    | 191                              |
| After P04     | 91,358                               | 34,255     | 27          | 43             | 57         | 191                              |
| After wave 2  | 92,251                               | 35,885     | 23          | 48             | 36         | 191                              |
| After wave 2½ | 92,379 (79,270 code)                 | 36,098     | 21          | 49             | 36         | 4 (2 files, allowed)             |
| **Target**    | **≤ 73,000 code lines** (decision 6) | —          | **0**       | **≤ 12**       | **≤ 20**   | **one per file, via `action()`** |

## Milestones (`refactor/main` → `main`, user approves)

Before each milestone, run the checks in [deferred-checks.md](deferred-checks.md) (network, browser
and by-eye checks the packages couldn't do).

| Milestone | After       | Requires                                                                                                | Status                                                                                                                                                            |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Wave 2 + 2½ | full suite green; every LLM tool and builder feature working again; UI callers on capabilities (P09b–d) | wave 2 merged into `main` 2026-11-19; wave 2½ done on `refactor/main` 2026-11-19, **waiting for your go to merge into `main`** ([review](reviews/milestone-1.md)) |
| 2         | Wave 4      | full suite green; `getContainer()` in `src/app` only in `CONTAINER_ALLOWED`                             | not reached                                                                                                                                                       |
| 3         | Wave 5      | full suite green; no file over 500 lines without a reason; docs updated                                 | not reached                                                                                                                                                       |

**Remove later:** [removal-list.md](removal-list.md) lists the scaffolding and dead-code candidates left behind, with who removes each. Add to it whenever you leave something.

## Decisions needed (ask the user; record the answer here and on the tududi task)

1. (tududi task 260) **Double-faced cards (P04):** does a spell with a land on its back count as a land for the
   deck's land count, the drafter and test hands? Today the builder says no and the drafter says
   yes. **Answered (2026-11-19): yes.** A double-faced card with a land face counts as a land
   everywhere: the deck's land count, the drafter and test hands.
2. (tududi task 261) **The mana curve (P16):** should everything share one curve (the builder's 0–7+), or should
   the drafter and "draft a deck" keep their own named versions?
   **Answered (2026-11-19): one curve, the builder's.** The drafter and "draft a deck" use the
   builder's mana curve (0–7+). P16 is unblocked.
3. (tududi task 262) **Card features storage (P11):** precompute at sync (needs a backfill) or compute when a deck
   loads and cache it?
   **Answered (2026-11-19), conditional:** precomputing at sync (and on update) is preferred, because
   other tools (similar cards, tags) benefit; compute-on-load avoids stale data and wasted work. P11
   first checks where card features are used: if they are used in many places and in deck building,
   compute at sync and update; otherwise compute on load and cache. Record the finding in P11's
   handoff.
4. (tududi task 263) **Splitting `decks` (P18):** four modules (`decks`, `deck-play`, `deck-advice`, `proxies`), or one `decks/` module with
   four responsibility subfolders, the way `research/` holds `reddit/` and `youtube/`?
   **Answered (2026-11-19): one `decks/` module with four responsibility subfolders.** P18 is
   unblocked.
5. (tududi task 264) **The 27 unregistered tools (P01):** any to bring back as bindings after P09?
   **Answered (2026-11-19): remove them completely, after checking their functions are covered.**
   Checked: `set_deck_entry`, `arrange_headings`, `check_owned`, `deck_facts`, `deck_tokens`,
   `deck_scorecard`, `get_wishlist`, the two YouTube tools, the opening-hand and mulligan tools and
   `idea_candidates` / `idea_budget_upgrades` are covered by `edit_deck`, `get_cards`, `get_deck`,
   `manage_wishlist`, `youtube_research`, `draw_sample`, `search_cards` and `find_replacements`.
   Builder-only (no tool): snapshots and diff, `draft_deck`, `commanders_i_can_build`, `list_sets`,
   the interactive goldfish, `idea_optimize_deck`, `idea_upgrade_roadmap`. Card packages
   (`create_package`, `apply_package`, `list_packages`) were not found in the builder either: check
   in P20 whether that feature still exists or is dead. None come back as tools.

6. (tududi task 266) **The line target:** keep ≤ 80,000 as a stretch goal, or revise it?
   **Answered (2026-11-19): revise it, and count code, not comments.** The user suspected the
   count included documentation. Checked: it counts `.ts` and `.tsx` files only (no Markdown), but
   about 13% of the lines are blank or comment-only (src: 6,454 blank, 6,266 comment-only of 91,161),
   so the raw 80,000 target was about 68,000 lines of code, a far bigger cut than it sounded. In code
   lines (no blanks or comment-only lines, `src` without tests), the baseline was 80,320 and wave 2
   ends at 78,441: the refactor has so far removed about 1,900 lines of code (2%) and added about 260
   lines of comments. `pnpm sizes` now prints **Code lines**. **New target: ≤ 73,000 code lines,
   stretch ≤ 70,000** (today 79,367 by the script, which also counts `worker/` and `scripts/`),
   from the remaining duplication of about 6,800 to 10,500 lines in the
   [dedup playbook](dedup-playbook.md). Raw lines are still printed, no longer a target.

## Decisions made

| #   | Decision                                                                                                        | Date       |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| —   | Work on branches; `refactor/main` may break; features are rebuilt; tests are rewritten for the new design       | 2026-11-18 |
| —   | 500 lines per file is the benchmark: over it needs a reason on the allowlist                                    | 2026-11-18 |
| —   | Lessons are deferred to the backlog; packages don't write lessons                                               | 2026-11-18 |
| —   | No feature is removed on purpose; only redundant code (duplicates, dead code, two implementations of one job)   | 2026-11-18 |
| —   | Layout is by responsibility: one responsibility per module, layer folders inside (ADR 0001); no feature folders | 2026-11-18 |
| —   | Wave 2½ (P09b–d) moves every UI caller onto capabilities before wave 3 (milestone 1 review, option A)           | 2026-11-19 |

## Broken right now (on `refactor/main`)

| What's broken | Broken by | Fixed by | Notes |
| ------------- | --------- | -------- | ----- |
| (nothing yet) |           |          |       |

## Backlog

- **Lessons for the refactor**, to plan after the refactor (or between milestones). It's on
  tududi's inbox (ProxyLib account, 2026-11-18). Candidate topics: characterization tests and
  reference outputs; `as const` arrays as the single source for types and schemas; SQL fragments
  as functions; ratchets for gradual cleanup; ports and adapters end to end (one capability, many
  callers); presenters that shape output for a reader; exhaustive error mapping with `assertNever`;
  the strategy pattern with `Record<K, ...>` and `satisfies`; "parse, don't validate" and
  versioned derived data; plugin registries; telling accidental duplication from essential
  similarity; bounded contexts and public API width; `useReducer`; working on long-lived
  branches.

## Tududi

The refactor is tududi project **"Refactor: audit and consolidation (doc 65)"** (uid
`saajqvk9drbreic`, ProxyLib account), with one task per package (P09b–P09d are tasks 274–276), each named `Pnn. …` and tagged
`refactor`. When a package changes status here, change its task too: in progress when started,
done when merged into `refactor/main`.

\* includes the P00 scripts (about 130 lines). \*\* a different counting method from the audit's 83: compare later runs with 63.
