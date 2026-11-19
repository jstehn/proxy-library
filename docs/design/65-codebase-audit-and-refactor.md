# Design: codebase audit and refactor plan

> Status: **draft, waiting for your approval** (2026-11-18). No code changes yet. The work is split
> into packages in [`docs/refactor/`](../refactor/README.md) (section 7). Packages marked "design
> doc" or "ADR" get theirs approved before their code starts (ADR 0023).
>
> Lesson: no (deferred: lessons for the refactor are in the backlog, `docs/refactor/STATUS.md`).
>
> **This is a living document.** It's the current best plan, not a contract. When a package finds
> that the code, a number or an assumption here is wrong, or a better design turns up, change the
> plan: update this doc and the affected packages, add a line to the change log (section 10), and
> leave a comment on the tududi task. Big changes (a new module, dropping or merging packages,
> changing a principle) get the user's OK first.

## 1. Purpose and scope

The app grew one feature at a time across 64 design docs. Much of it was added on top of earlier
work instead of being folded into it. The goldfish simulator showed both sides of that. Its cast
rules first grew by adding a commander-specific branch for each new card (the Henzie blitz
inference, removed in `8c3f8c3`). They became reliable once they moved to an open/closed plugin
pipeline (`decks/domain/sim-pipeline.ts`). This audit looks for the places where the code still
works the old way, and plans how to move them to designs that are extended by adding things, not
by editing a long list of special cases.

**Scope:** everything under `src/`, `worker/` and `scripts/`, about 93k lines of source (not
counting tests). **Not in scope:** new features, performance tuning, the deployment setup.

### How the audit was done

- Measured every module and file (lines, exports, test files next to each one).
- Counted how often each file changed in git (which files keep getting edited).
- Searched for repeated code: hard-coded format checks, oracle-text regexes, type definitions,
  error-message maps, abbreviations the conventions forbid.
- Read the biggest files: the LLM tool layer, the deck builder, suggestions, the simulator, the
  composition root.
- Ran `pnpm check` for a baseline: **all green** (typecheck, lint, cycles, format, unit tests).

**Limits.** I read the hotspots closely but only sampled the rest. Counts come from `grep` and are
approximate (a regex count includes some SQL strings, for example). A large file with "no test
file" may still be covered by an integration test or a test of the code that calls it. Each
phase's plan rechecks its own numbers before any code moves.

### The end state

The refactor is done when the code is **cohesive** (each module has one responsibility), **wired
by injection** (nothing reaches out for its own dependencies), **says each thing once**, is
**much smaller**, and **can be understood from the directory tree alone**.

**Every feature stays.** The code shrinks by removing what's _redundant_: duplicates, dead code,
and two implementations of one job (which are merged, not dropped). Nothing a player can do today
is removed on purpose.

#### Measurable targets

P00's report (`pnpm sizes`) prints these numbers, and STATUS tracks them after every wave.

| Measure                                             | Today (2026-11-18)              | Target at milestone 3                                         |
| --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| Source lines (`src`, `worker`, `scripts`, no tests) | **93,361**                      | **≤ 80,000** (−15%), only from removing redundancy            |
| Source files over 500 lines                         | 28                              | 0 without a written reason                                    |
| Biggest folder (source files in one folder)         | 43 (`decks/domain`)             | ≤ 12 (more usually means the module has two responsibilities) |
| Biggest public API (`index.ts`)                     | 544 lines, ~440 names (`decks`) | ≤ 150 lines per module                                        |
| Duplicated 6-line runs (clone check)                | 83                              | ≤ 20                                                          |
| Duplication groups D1–D14 (section 4)               | 14 open                         | 0 open                                                        |
| `getContainer()` calls in `src/app`                 | 191 in 87 files                 | one helper (see "Injection")                                  |
| Module-level mutable state                          | 3 (`pendingPreviews`, …)        | 0                                                             |

**Where the −15% comes from** (estimated from this audit, rechecked by each package; packages
update this table when they learn more):

| Source                                                                                  | Lines, roughly                            |
| --------------------------------------------------------------------------------------- | ----------------------------------------- |
| The 27 dead tool wrappers (P01, measured)                                               | −2,200                                    |
| The rest of the tool layer: 6.6k lines become bindings and generic transports (P05–P09) | −3,000                                    |
| Candidate queries, prices, store quote (D1, D2, D11)                                    | −1,500                                    |
| Four hand engines → one; curves; collections (D3, D5, D10)                              | −1,200                                    |
| Oracle-text parsing and the two signals systems → card features (D12)                   | −1,000                                    |
| Types, schemas, money, error text, deck checks (D6–D9)                                  | −800                                      |
| Unused exports and files (`knip`, P01)                                                  | −1,000 to −3,000 (unknown until measured) |
| Builder UI duplication found while splitting it (P19)                                   | −500 to −1,000                            |
| **Total**                                                                               | **about −11,000 to −14,000**              |

**Measured after P04 (2026-11-19).** P01 removed 2,682 lines (less than the knip row hoped), and
P02–P04 added 297 (they fixed disagreements; they weren't meant to shrink much). The remaining
groups, re-measured and ranked in [the dedup playbook](../refactor/dedup-playbook.md), add up to
about −6,800 to −10,500, which lands at roughly 80,900–84,600 lines. The ≤ 80,000 target is now a
stretch: it holds only if every group hits the top of its range or packages find more redundancy.
The playbook keeps the per-group numbers; packages report what they actually removed.

#### Readable from the directory tree

The tree is split by **responsibility**. A folder's name always says what its contents are
responsible for, and responsibilities can **nest**: a broad responsibility groups the narrower
ones that serve it.

- **Modules** are the app's broad responsibilities: money, the catalog, the store, decks,
  drafts, research, and so on.
- **A module can group related responsibilities as subfolders**, when they share a purpose but
  do different work. `research/` is the model: deck research from outside sources, with
  `reddit/` and `youtube/` inside, one per source. Both serve the same callers (the LLM tools),
  so they belong together, but they talk to different services, so they're kept apart inside.
- **At the bottom, the layer folders** (ADR 0001) separate the kinds of work: `domain/` holds the
  rules, `application/` the use cases and the ports they need, `infrastructure/` talks to
  Postgres and outside services, `queries/` reads for pages, and `testing/` holds fakes.

The folder-size target is the check that this holds. A layer folder with more than about 12
files usually means it holds two responsibilities, which should each get a folder of their own:
either a subfolder of the module (as in `research/`) or a module of its own. `decks/domain/`'s
43 files are four responsibilities: keeping a deck's list, playing a deck, advising on a deck,
and printing a deck. Decision 4 in STATUS chooses whether they become four modules or one
`decks/` module with four subfolders. Both follow the same rule.

```
src/
  server/core.ts        the composition root: the one place that builds and injects everything
  app/                  Next.js pages and server actions: adapters only, no logic
    _llm/               the model's adapter: bindings/, mcp.ts, openapi.ts, http.ts
  shared/               kernel (Result, Cents, Rng, Clock), db, config, http, card-search
  modules/
    accounts/           who you are, sign-in, permissions
    wallet/             your money: the ledger, allowance, grants
    catalog/            cards, printings, prices, card features, syncing outside data
    packs/              opening a booster: sheets and odds
    store/              buying and selling, and what things cost
    inventory/          sealed product you own
    collection/         cards you own in the game
    real-collection/    cards you own on paper
    wishlist/           cards you want
    trades/             swapping with other players
    drafts/             live booster drafts
    social/             profiles and friends
    activity/           the feed
    reset/              emptying a player's library
    research/           deck research from outside sources
      reddit/             threads and comments
        domain/  application/  infrastructure/  testing/
      youtube/            deck techs and transcripts
        domain/  application/  infrastructure/  testing/
      index.ts            one public API for both
    decks/              a deck's list: entries, formats, legality, headings, snapshots, sharing
    deck-play/          playing a deck alone: opening hands, goldfish, the simulator, odds
    deck-advice/        what to add, cut or swap: candidates, rating, suggestions, mana base
    proxies/            printing a deck: sheets, playtest cards, tokens, PDF
      domain/  application/  infrastructure/  queries/  testing/  index.ts  client.ts
```

(The four deck responsibilities are drawn as modules here. With decision 4's other answer, they
sit under one `decks/` the way `reddit/` and `youtube/` sit under `research/`.)

#### Injection

The factory DI from ADR 0002 stays and becomes universal:

- **Everything below an adapter gets its dependencies as factory parameters**, from
  `src/server/core.ts`. A query never receives a raw `db` from a page; it's wired into a read
  service, and the page calls the service.
- **Adapters get capabilities from one helper**, not a container lookup per call:
  `action(async ({ actor, capabilities }, input) => …)` for server actions, and the same shape for
  bindings and routes. That replaces the 191 `getContainer()` calls and the repeated
  `requireActor()` lines.
- **No module-level mutable state.** State lives behind a port (a repository) or in the request.
- **Every port has a fake in `testing/`**, so a feature's tests build its service with fakes and
  no database.

## 2. Summary

### What's already healthy (keep it)

- **The architecture rules are real and enforced.** Boundary lint (ADR 0009), a cycle check, one
  composition root (`src/server/core.ts`, 299 lines and readable), config read only in
  `shared/config` (no stray `process.env` found), money as `Cents`, `Result` errors. Only 13
  `as any` / `as unknown as` casts in 93k lines, and every `eslint-disable` (25) is for
  `<img>` tags served by the image cache.
- **External data goes through one gateway.** Every outside service enters through a port in
  `catalog/infrastructure` (or `reddit`/`youtube`) and is checked with Zod.
- **Rules as data, where it's been done.** `sim-pipeline.ts` (cast modifiers, zone permissions,
  trigger handlers, replacement effects as plugins) and `drafts/domain/abilities.ts`
  (`DRAFT_ABILITIES`, the Conspiracy cards as a table) are the model to copy.
- **The test suite is large and fast.** 193 test files, all offline.

### The main problems

| #      | Finding                                                                                                                                  | Cost of leaving it                                                                                               | Phase  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| F1     | `decks` is a god module: 22k lines, 84 files, ~440 exported names, at least 5 jobs                                                       | Every deck feature edits `decks/index.ts` (48 commits)                                                           | R7     |
| F2     | The LLM tool layer is a second application layer inside `src/app`, with dead code and logic                                              | 6.6k lines; 27 of 72 tools are unreachable; previews lost on restart                                             | R1, R3 |
| F3     | 60 `format === "..."` checks in ~20 files, despite `FormatRuleSet`                                                                       | A new format means editing all 20 files (the commander-branch smell again)                                       | R4     |
| F4     | Oracle text is interpreted in at least 9 places, with two separate "signals" systems                                                     | A card can be a "ramp" card in one place and not in another                                                      | R5     |
| F5     | Shared words are defined many times: `Color` ×15, two `ManaColor`s, two `DeckProfile`s                                                   | Types drift apart; a fix in one copy misses the others                                                           | R2     |
| F6     | The `queries/` layer has grown into a service layer (scoring, orchestration, query → query)                                              | Logic can't be unit-tested without Postgres; ADR 0006 has drifted                                                | R3     |
| F7     | UI actions and LLM tools each map errors to text with `Record<string, string>`                                                           | A new error kind silently shows a generic message                                                                | R3     |
| F8     | `deck-builder.tsx` is 1,459 lines with 35 `useState`/`useEffect` calls; its actions file is 845 lines                                    | Hard to change one panel without risking the others                                                              | R8     |
| F9     | `shared/card-search` (4.9k lines) now holds domain knowledge (tags, themes, signals, brackets)                                           | "Shared" stops meaning "small and stable"                                                                        | R5     |
| F10    | Conventions have drifted: `ctx` ×216, `res`, `obj`, `val`, `tl`; the overview doc is out of date                                         | The code teaches the habits it says to avoid                                                                     | R9     |
| D1–D14 | **The same job written many times** (section 4): 45 copies of "today's price", 4 hand engines, 5 rules for "is it a land", 4 mana curves | Copies already disagree, so the builder, the goldfish game, the drafter and the model can give different answers | R2–R6  |

## 3. Findings in detail

### F1. `decks` does at least five jobs

**Evidence.** `src/modules/decks` has 22,060 lines in 84 non-test files. That's a quarter of all
module code and more than the next three modules together (catalog 7.1k, drafts 5.8k, accounts
2.9k). `decks/index.ts` has 69 `export` statements covering about 440 names. It's the most edited
file in the repo, along with `_llm-tools/tools/decks.ts` (48 commits each). The domain folder
mixes:

| Job                          | Files (domain / queries / application)                                                                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deck lists and legality      | `deck`, `boards`, `rules`, `format-rules`, `commanders`, `headings`, `notes`, `list-format`, `snapshots`, `manage-decks`                                                                                                                                  |
| Sharing and comments         | `sharing` (domain, application, infrastructure)                                                                                                                                                                                                           |
| Proxies and printing         | `proxy-sheet`, `playtest-card`, `token-proxies`, `proxy-progress`, `art-filters`, `pdf-lib-renderer`, `playtest-painter`                                                                                                                                  |
| Play simulation              | `goldfish`, `goldfish-session`, `goldfish-types`, `sim-pipeline`, `draws`, `mulligan-trainer`, `castability`, `mana`                                                                                                                                      |
| Analysis and recommendations | `rate`, `suggest`, `swaps`, `optimize`, `replacements`, `eval`, `signals`, `packages`, `upgrade-roadmap`, `brackets`, `deck-profile`, `mana-base`, `draft-deck`, `queries/suggestions`, `queries/embeddings`, `queries/semantic-search`, `queries/combos` |

**Why it hurts.** Goal 2 in the overview says each feature lives in one place, and that's no
longer true. A change to suggestions can break the proxy sheet's types, because everything shares
one public API and one set of domain types. The 440-name index can't be read in one sitting.

**Direction.** Split along the jobs above (R7). The split should come after R2 to R5, because those
phases remove most of the tangles that would otherwise cross the new boundaries.

### F2. The LLM tool layer is a second application layer

**Evidence.**

- `src/app/_llm-tools/tools/` has 7 files and about 6.6k lines. `decks.ts` alone is 3,923 lines.
- It defines **72** tools with `defineTool`, but `registry.ts` serves only **16**. **27** are
  referenced nowhere outside their own file, and `mcp.ts`/`openapi.ts` serve only `TOOLS`, so
  those 27 can't be reached. Among them: `goldfishStepTool`, `optimizeDeckTool`,
  `deckScorecardTool`, `mulliganDrillTool`, `upgradeRoadmapTool` and `diffDeckTool`. (Their domain
  code is still used by the UI. Only the tool wrappers are dead.)
- The 16 registered tools in `consolidated.ts` call other tools' `.run()` and then rewrite the JSON
  they return (`stripProvenance`, `compactMoneyFields`). Composing tools by post-processing their
  output is brittle: if the inner tool renames a field, the outer one silently stops compacting it.
- Domain logic lives in the adapter: `problemsOf`, `bracketOf`, `cardsBehindRoleCounts`,
  `listAndFingerprint`, plus 10 `format === ...` branches (F3).
- `pendingPreviews` is a module-level `Map` (`tools/decks.ts:1852`), so a `previewId` from
  `edit_deck save=false` is lost on restart and wouldn't be shared by a second app process. Goldfish
  sessions, which do the same job, are stored in Postgres behind a port. Two answers to one
  problem.

**Why it hurts.** The server actions and the LLM tools are two adapters over the same use cases,
but each carries its own copy of the logic in between, so the UI and the model can disagree about
the same deck.

**The root cause.** A "tool" today is where the capability is _defined_. It should only be one way
to _reach_ a capability. Reading a deck's problems, previewing a list change and drawing a sample
hand are things the app can do, whoever asks. MCP is one way to ask. The UI's server actions,
`/api/tools`, OpenAPI and the worker are others. Each of those should only translate: parse the
caller's input, call the function, and shape the result for that caller.

**Direction (R1, R3).** Delete the dead wrappers (R1). Then (R3):

```
modules/<module>/application/      capabilities: typed use cases and read services
  deckProblems(actor, deckId)      → Result<DeckProblems, DeckNotFound>
  previewChanges(actor, input)     → Result<ChangePreview, PreviewError>
  applyPreview(actor, previewId)   → Result<ApplyReport, ApplyError>
        ▲ wired in src/server/core.ts, exactly like today's write use cases
        │
  ┌─────┴───────────────┬──────────────────────────────┐
app/decks/**/actions.ts   app/_llm-tools/bindings/*.ts    worker, API routes
(UI: form → call → view)  (model: name, description,     (same functions)
                           scope, schema, call, present)
                                  ▲
                    mcp.ts · openapi.ts · http.ts   transports: know nothing about decks
```

- **Capabilities live in modules.** Each is a plain typed function returning a `Result`, with its
  input schema exported next to it, so the server action and the tool validate the same way.
- **A tool binding is a small declarative record:** `name`, `description` (written for a model),
  `scope`, `input` (the capability's schema plus `.describe()` text), `call` (which capability or
  capabilities to call) and `present` (a typed function from the result to the compact JSON the
  model gets). A binding never calls another binding and never rewrites JSON afterwards.
- **"Consolidated" tools are composition in the right place.** `get_deck` with
  `include: ['facts', ...]` becomes a `deckOverview(actor, deckId, sections)` read service, which
  the builder page can use too, instead of a tool that runs five other tools.
- **Transports are generic.** `mcp.ts`, `openapi.ts` and `http.ts` take the list of bindings and
  handle protocol, scopes and the response-size cap. Adding a tool is one binding file, and
  exposing it to the model or hiding it is one line in the list.
- **Previews are a capability, not tool state.** `previewChanges` / `applyPreview` store the
  preview behind a `PreviewRepository` port (Postgres, with a TTL), so they survive restarts. The
  builder can also offer "review changes before saving" with the same code.

### F3. Format checks break open/closed (the commander-branch smell again)

**Evidence.** 60 `format === "..."` / `format !== "..."` checks in about 20 files, with the most in
`_llm-tools/tools/decks.ts` (10), `queries/suggestions.ts` (6), `domain/stats.ts` (6),
`domain/packages.ts` (4) and `domain/draft-deck.ts` (3), plus the builder UI. A `FormatRuleSet`
already exists (`domain/format-rules.ts`) and the simulator uses it, but most code goes around it.
Design doc 44 (sixty-card formats) is the record of what this costs: adding formats meant hunting
down hardcoded `100`s and singleton assumptions across the builder, the drafter and the tools.

**Direction (R4).** Make `FormatRuleSet` the one place that knows how formats differ: deck size,
copy limit, whether there's a command zone, color identity, whether brackets apply, sideboard
size, the starting hand, and the knobs suggestions use. Define it as
`Record<Format, FormatRuleSet>` with `satisfies`, so adding a format is a compile error until every
rule is filled in. Callers ask a question (`rules.hasCommandZone`) instead of naming a format.

### F4. Oracle text is interpreted in many places

**Evidence.** Code that reads a card's rules text and decides what the card does exists in at
least these places:

- `shared/card-search/tags.ts`, `primitives.ts`, `signals.ts` (role tags, themes, deck signals)
- `decks/domain/signals.ts` (a _second_ signals system: "produces/consumes", design doc 46),
  `deck-profile.ts`, `mana.ts` (tap-mana production), `castability.ts`, `rules.ts`,
  `token-proxies.ts`
- `decks/domain/sim-pipeline.ts`: 21 runtime regexes, for example finding Muldrotha by the phrase
  "cast a permanent spell of each permanent type from your graveyard"
- `drafts/domain/timers.ts:177` checks `name === "Cogwork Librarian"`, even though
  `DRAFT_ABILITIES` exists to keep card names out of code

ADR 0019 already stores _some_ features at sync time (role tags), but the simulator, mana
analysis and deck profile parse the text again at runtime, each with its own regexes.

**Why it hurts.** This is the deepest version of the problem you described. The plugin pipeline
fixed _how the simulator is extended_, but every plugin still has its own idea of _what a card
says_. If two regexes for the same ability differ, the card counts as ramp in suggestions but
can't tap for mana in the goldfish game.

**Direction (R5; needs its own design doc and ADR).** One **card features** model: a pure,
versioned function `oracle text + type line + mana cost → CardFeatures` (mana production, cost
reduction, cast permissions, triggers, role tags, themes, signals). Compute it once at sync time
(extending ADR 0019), store it with a `featuresVersion`, and have every consumer read the
structured value. The sim-pipeline plugins then match on features, not text. The two signals
systems become one. Tags, themes and signals move out of `shared/card-search` (F9). Each
recognizer gets fixture tests on real card text, so a regex fix is one change with one test.

### F5. Shared words are defined many times

**Evidence.**

- The five colors are defined about 15 times: `catalog/domain/types.ts` (`Color`), plus
  `COLORS`/`ALL_COLORS`/`COLOR_ORDER`/`MANA_COLORS` constants in drafts, packs, social and decks,
  and **seven** copies of `z.enum(["W", "U", "B", "R", "G"])` in infrastructure and queries files.
- `decks` has two different `ManaColor` types (`domain/mana.ts` includes `"C"`, `domain/stats.ts`
  doesn't) and two `MANA_COLORS` constants (`stats.ts`, `mana-symbols.ts`).
- Two unrelated `DeckProfile` types (`domain/deck-profile.ts` and `domain/suggest.ts`), so
  `queries/suggestions.ts` has to rename one on import (`DeckProfile as DeckPlanProfile`).
- `isPlayed(board)` exists in `domain/boards.ts`, but three files write
  `board === "main" || board === "commander"` inline (`app/decks/[id]/page.tsx`,
  `builder/actions.ts`, `_llm-tools/tools/decks.ts`).

**Direction (R2).** One `Color` (plus `ColorSchema` and `COLORS`) exported from catalog's
client-safe API, one `ManaSymbol` type for "colors plus colorless", every inline copy replaced,
and the two `DeckProfile`s renamed for what they mean (for example `DeckPlan` for key and avoid
cards, `DeckFingerprint` for the suggestion profile).

### F6. `queries/` has grown into a service layer

**Evidence.** ADR 0006 sets read models up as "SQL in, plain view objects out". But
`decks/queries/suggestions.ts` (1,053 lines) mixes SQL with scoring, combo partners, embeddings
and budget picks, and calls other queries (`deckView`, `embedSimForCards`, `comboPartnersForDeck`,
`ownedCopies`). `audit.ts`, `optimize.ts`, `mana-base.ts`, `draft-deck.ts` and
`upgrade-roadmap.ts` follow the same pattern. Server actions call queries with the raw `db`
(`getContainer().db`) next to use cases (`getContainer().decks.setEntry`), so there are two ways
in, and some actions also add their own logic (which boards count for combos, for example).

**Why it hurts.** The scoring logic can only be tested against Postgres, and every query that
calls another query makes one SQL round trip per step.

**Direction (R3).** Keep `queries/` as SQL → view. Add **read services** in `application/`
(`deckAdvice.suggestionsFor(actor, deckId)`) that load data through ports and call pure domain
functions. They're wired in `core.ts` like the write use cases, so the UI and the LLM tools call
the same thing. A fake port makes them unit-testable.

### F7. Errors are turned into text twice, without exhaustiveness checks

**Evidence.** 8 server actions use `const messages: Record<string, string> = {...}` with
`?? "Couldn't change the deck."` as a fallback. The LLM tools do their own mapping. If a new
error kind is added to a `Result` union, both adapters compile, and the user sees a generic
message.

**Direction (R3).** One `describe<Module>Error(error)` per module, written as an exhaustive
`switch` that ends in `assertNever`, used by both the actions and the tools.

### F8. The deck builder UI is one large component

**Evidence.** `app/decks/[id]/builder/deck-builder.tsx` is 1,459 lines with 35 `useState` and
`useEffect` calls. `builder/actions.ts` is 845 lines with 29 server actions. Next in size are
`deck-list.tsx` (607), `snapshots-panel.tsx` (465), `primer-panel.tsx` (426), plus the drafts
page (654) and the pick grid (471).

**Direction (R8).** Move the builder's state into a `useReducer` with named actions (one state
type, testable without React), give each panel its own component and hooks, and split the actions
file by panel.

### F9. `shared/card-search` holds domain knowledge

ADR 0017 created `shared/card-search` for the search language and its SQL. It's now 4.9k lines,
and about half is domain knowledge (`tags.ts` 578, `signals.ts` 518, `primitives.ts` 435,
`brackets.ts`). The overview says `shared/` isn't "a utils dumping ground". This is handled in R5,
when tags, themes and signals move into the card features model.

### F10. Conventions have drifted

- **Abbreviations** the conventions forbid: `ctx` 216 times (`drafts/domain/steps.ts` 65,
  `sim-pipeline.ts` 47, `drafts/application/drafts.ts` 31, `timers.ts` 30), plus `res` 33, `obj`,
  `val`, `tl`.
- **Docs:** the overview's module table and dependency graph don't include `social`, `reddit` or
  `youtube`. `docs/decisions-to-review.md` is 67 KB of reviewed overnight decisions.

### F11. Test gaps that matter for refactoring

Big files with no test file next to them include `_llm-tools/tools/decks.ts`, `consolidated.ts`,
`library.ts`, `queries/suggestions.ts`, `application/manage-decks.ts`, `domain/sim-pipeline.ts`,
`drafts/domain/steps.ts` and `deck-builder.tsx`. Some are covered indirectly
(`llm-tools.int.test.ts`, `goldfish-session` tests), but the **exact shape of the LLM tool output**
matters to the model and isn't pinned anywhere. A refactor must not change it by accident.

### Lower priority (noted, not planned)

- `reddit` and `youtube` are separate modules that only the LLM tools use. They could become one
  `research` module, but they're small and stable, so it isn't worth doing yet.
- 8 hand-written color/format Zod enums in the infrastructure layer could be derived from the
  domain constants. That's covered by R2.

## 4. Duplication: the same job written many times

Duplication is the biggest single source of debt here, and most of it isn't copy-paste. A
line-by-line clone scan (a script hashing every run of 6 normalized lines) finds only **83**
duplicated runs, mostly inside `decks/queries`. The larger problem is the same _job_ written
again by hand, with different names and often slightly different rules, each time a feature needed
it. Those copies have started to **disagree** (the land and curve examples below), and that's how
duplication turns into bugs: the deck builder, the goldfish game, the drafter and the LLM tools
give different answers about the same card.

### 4.1 The catalogue

Each group is one job. "Copies" counts the implementations found. "Disagree?" says whether the
copies already give different answers. "Home" is where the single version will live.

| #   | One job                                                        | Copies found                                                                                                                                                                                                                                                                                                                                       | Disagree?                                                                                                     | Home                                                                            | Phase  |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| D1  | **Today's price of a printing**                                | **45** hand-written `price_snapshots` subqueries in **29** files (decks ×16 files, store, wishlist, trades, collection, real-collection, packs, drafts, card-search)                                                                                                                                                                               | Not today. Singles sell at 100% of the latest snapshot. But any change to that rule means editing 29 files    | `catalog`: one `currentPrice` SQL fragment (or a Postgres view)                 | R2     |
| D2  | **Cards you could add: owned and for sale, cheapest printing** | `with cheapest as (...)` / `distinct on` blocks in 12 files (`suggestions`, `commanders`, `deck-combos`, `semantic-search`, `draft-deck`, `mana-base`, `search-for-deck`, `browse`, `card-facts`, `store`, `catalog`, `consolidated.ts`); `toCandidate` ×3, `ownedCandidates` ×2, `storeCandidates` ×2, `textArray` ×4                             | Each picks its own price finish and filters                                                                   | One `CandidatePool` read port (owned + store, with filters)                     | R3     |
| D3  | **Opening hands and mulligans**                                | 4 engines: `draws.ts` (test hand), `goldfish-session.ts` (playable game), `goldfish.ts` (Monte Carlo odds), `mulligan-trainer.ts` (drill). Each deals, mulligans and bottoms its own way. `isEarlyPlay`/`isEarlyRamp` written twice, word for word; the "keepable hand" rule written twice                                                         | The drill and the simulator can judge the same hand differently once their options drift                      | One `opening-hand` domain: deal, London mulligan, bottom, keep policy           | R6     |
| D4  | **Is this card a land?**                                       | About 24 files. At least 5 rules: front face only (`decks/stats.ts`), whole type line (`drafts/auto-pick.ts`, `app/drafts/[id]/pool.ts`), any face (`playtest-card.ts`), case-insensitive on the battlefield (`mana.ts`), back-face land as a special case (`castability.ts`)                                                                      | **Yes.** A modal double-faced spell/land counts as a land in drafts but not in the deck builder               | `CardFeatures.isLand` / `landFaces`; a catalog helper until then                | R2→R5  |
| D5  | **The mana curve**                                             | 4 bucket schemes: `stats.ts` 0–7+ (floor), `rate.ts` 0–6 (floor), `drafts/auto-pick.ts` 1–6 (**round**), `draft-deck.ts` "1-2 / 3 / 4 / 5+"                                                                                                                                                                                                        | **Yes.** "A gap at 2" means something different in each                                                       | One `manaCurve(lines, scheme)` with named schemes                               | R6     |
| D6  | **Basic types and their schemas**                              | `Finish`: 20 inline unions + 18 inline `z.enum` copies, even though `catalog` exports `Finish`/`FINISHES`. `FinishSchema` ×11, `ColorSchema` ×8, `RaritySchema` ×2, `StatusSchema` ×3, `Color` ×15, `ManaColor` ×2 (one with `C`), `MANA_COLORS` ×3, `DeckProfile` ×2, a `timestamptz` column type in all 11 `schema.ts` files, `cents` columns ×3 | Mostly not yet; `ManaColor` already does                                                                      | `catalog/client`: types + `as const` arrays + schemas; `shared/db` column types | R2     |
| D7  | **Showing money**                                              | `Cents.format` exists, but there are 5 hand-written `(cents / 100).toFixed(2)`, `dollars()` ×3, `money()` ×2, `priceCents()` in the tools                                                                                                                                                                                                          | Rounding and "no price" handling differ                                                                       | `Cents.format` (plus `Cents.formatOrDash`)                                      | R2     |
| D8  | **Turning an error into a message**                            | `messageFor` ×9 in server actions, 8 `Record<string, string>` maps in the builder actions, separate error text in each LLM tool                                                                                                                                                                                                                    | The UI and the model word the same error differently, and a new error kind falls through to a generic message | One `describe<Module>Error` per module, with `assertNever`                      | R3     |
| D9  | **Checking a deck**                                            | `problemsOf` ×2 (`builder/derive.ts`, the tools), `bracketOf` in the tools, `board === "main" \|\| board === "commander"` inline ×3 although `isPlayed` exists                                                                                                                                                                                     | Possible: the builder and the model can each count different boards                                           | `decks` capabilities (`deckProblems`, `deckBracket`)                            | R3     |
| D10 | **Showing a collection**                                       | Game and real collection are built twice: `collection/queries/collection.ts` ↔ `real-collection/queries/real-collection.ts` (119 shared lines), `app/collection/page.tsx` ↔ `app/collection/real/page.tsx` (81), the two export routes (21 of 27)                                                                                                  | Small differences, mostly in filters                                                                          | Shared read helpers and page components; tables stay separate                   | R6     |
| D11 | **Today's offer for a card**                                   | `store/queries/shopping-list.ts` ↔ `wishlist/queries/for-sale.ts` (44 shared lines), plus D2's copies                                                                                                                                                                                                                                              | Wishlist and store quotes can drift                                                                           | `store`: one `quote` read port; wishlist calls it                               | R3     |
| D12 | **Reading oracle text**                                        | See F4: 9+ places, two signals systems, `withoutReminders` ×2 plus ad-hoc reminder regexes                                                                                                                                                                                                                                                         | **Yes** (ramp in one place, not in another)                                                                   | `CardFeatures`                                                                  | R5     |
| D13 | **Tools**                                                      | See F2: 72 tool definitions for 16 tools, tools calling tools and rewriting their output                                                                                                                                                                                                                                                           | n/a                                                                                                           | Capabilities + bindings                                                         | R1, R3 |
| D14 | **Format differences**                                         | See F3: 60 `format === ...` checks                                                                                                                                                                                                                                                                                                                 | Possible: a format can be "commander-like" in one place and not another                                       | `FormatRuleSet`                                                                 | R4     |

Smaller copies (fixed when their files are touched, not planned on their own): `samplePrintingId`
×4 in test helpers, `newestFirst` ×3, `plainText` ×2, `useIsBrowser` ×2, the duplicate auth forms.

### 4.2 How each group gets merged

The same five steps, every time:

1. **Inventory.** List every copy (the table above is the starting point; a phase rechecks it
   with `grep` before it starts).
2. **Find the disagreements.** Write a test that runs every copy on the same inputs, including
   edge cases (double-faced cards, split cards, mana value 0 or 7+, no price, foil-only). Where
   copies disagree, **you choose the right answer** (section 9) and the decision is written in the
   phase's plan. This is the step that fixes bugs, so it isn't skipped.
3. **One home.** Put the single version in the module that owns the data or the rule: `catalog`
   for card facts, types and prices; `store` for what something costs to buy; `shared/kernel` for
   `Cents`; `shared/db` for column types and SQL helpers. Export it through `index.ts` (or
   `client.ts` if the browser needs it).
4. **Move every caller, then delete the copies** in the same commit series. A copy left behind
   "for now" is how this happened in the first place.
5. **Guard it** so a new copy fails `pnpm check` (4.3).

**When a copy is allowed.** Two pieces of code that look alike but answer _different_ questions
stay separate, and get names that say why. Example: if the drafter really wants rounded mana
values, it gets a named curve scheme (`DRAFT_CURVE`), not a private `curveBucket`. The test is:
"if the rule changed, would both have to change?" If yes, it's one job.

### 4.2½ Where the savings come from

Ranked by lines removed, re-measured after P04. The [dedup playbook](../refactor/dedup-playbook.md)
has each group's inventory command, target shape, edge cases and mistakes to avoid, written so a
session can follow it step by step.

| Rank | Group                                                   | Catalogue   | Removable, roughly | Packages |
| ---- | ------------------------------------------------------- | ----------- | ------------------ | -------- |
| 1    | Tools and server actions compose the same reads by hand | D13, F2, D9 | −3,000 to −4,000   | P05–P09  |
| 2    | Queries doing a service's job; one candidate pool       | D2, F6      | −1,200 to −1,800   | P06, P07 |
| 3    | Oracle text read in 11 files → card features            | D12, F4     | −1,000 to −1,800   | P11–P14  |
| 4    | Four opening-hand engines → one                         | D3          | −500 to −800       | P15      |
| 5    | Collections, store quote vs. wishlist offer             | D10, D11    | −350 to −500       | P07, P17 |
| 6    | Format checks → `FormatRuleSet`                         | D14, F3     | −150 to −300       | P10      |
| 7    | Error text → `describe<Module>Error`                    | D8, F7      | −150 to −250       | P09      |
| 8    | Mana curve                                              | D5          | −50 to −100        | P16      |
| 9    | Builder UI state and calls                              | F8          | −300 to −800       | P19      |
| 10   | Small clones in social, catalog, wallet                 | —           | −100 to −200       | P20      |

The pattern behind rank 1 is the most important finding: **writes already go through application
services, but reads don't.** Server actions and tools both call query functions with
`getContainer().db` and compose the answer themselves, so every read the builder and the model
share is written twice. Making each read a capability (ADR 0026) removes the second copy and most
of the tool layer.

### 4.3 Keeping it consolidated

- **A clone check in `pnpm check`.** Add the clone scan as `scripts/clones.ts`, wired into
  `scripts/check.sh` with a **ratchet**: the baseline count is stored in the repo and may only go
  down. New copy-paste fails the check; removing some lowers the baseline.
- **Lint rules for the known patterns** (`no-restricted-syntax` / `no-restricted-imports`, each with
  a message naming the right home):
  - `z.enum([...])` containing `"nonfoil"` or `"W"` outside `catalog`
  - `/ 100).toFixed(` anywhere except `Cents`
  - the text `price_snapshots` in SQL outside `catalog`
  - `/\bLand\b/` outside `catalog` (and, after R5, outside card features)
  - `format === "<literal>"` outside `format-rules.ts` (R4)
- **A "where does this live?" table** in `docs/architecture/conventions.md`, one row per group
  above, so the next feature finds the existing version instead of writing another.

## 5. Principles the refactor follows

1. **Structure first; rebuild what breaks.** Packages change structure, and features may break on
   `refactor/main` while they're rebuilt on the new design. Every breakage is tracked in STATUS.
   Unrelated bug fixes go to the backlog unless they block the package.
2. **Open/closed where variation is real.** Formats, card abilities, draft abilities and
   simulator mechanics are lists of strategies or data checked by the compiler (`Record<K, ...>`
   with `satisfies`). The rule from `patterns.md` still applies: no abstraction without at least
   two real variants.
3. **One meaning, one definition.** A domain word (`Color`, `DeckProfile`, "played board") has one
   type and one home.
4. **Capabilities live in modules; adapters only translate.** Everything the app can do is a
   typed function in a module's `application/` layer. Server actions, MCP tool bindings,
   `/api/tools`, OpenAPI, the worker and API routes parse their caller's input, call those
   functions, and shape the result for that caller. None of them holds logic, and none of them
   calls another adapter.
5. **Parse once.** Outside text (oracle text, MTGJSON, Scryfall) becomes structured types at the
   edge, once, and is never parsed again later.
6. **Small, independent packages.** Each package fits in one session, lives on its own branch,
   says what it touches so parallel sessions don't collide, and leaves a handoff note.
7. **500 lines is the benchmark.** A file over it probably does more than one job: split it by
   job, or write down why it's fine.
8. **Cohesion: one responsibility per module.** Code that changes together lives together. A
   module's name says its responsibility, and its layer folders separate rules, use cases,
   persistence and reads.
9. **Inject, don't reach.** A function gets what it needs from its factory's parameters. Only the
   composition root builds real implementations, and adapters get capabilities from one helper.
10. **Less code is the goal, not a side effect.** Every package reports its line count before and
    after. Only redundant code is removed; every feature stays.

## 6. Ports and persistence changes (summary)

| Phase | Change                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R5    | New stored `card_features` (jsonb plus `features_version`) per oracle card, filled by the worker's sync. A migration and a one-off backfill (`pnpm worker sync features`) |
| R3    | New read-service ports (for example `DeckAdviceSource`) implemented by the existing query code                                                                            |
| R3    | `PreviewRepository` port, backed by a `deck_change_previews` table with a TTL (or by the goldfish-session table's pattern)                                                |
| R7    | No tables move. Schema files move with their modules, and lint boundaries are updated (ADR 0009)                                                                          |

## 7. The refactor plan

The plan is carried out as **work packages** in [`docs/refactor/`](../refactor/README.md), small
enough for one session each, so the work can be spread across sessions or agents, each starting
from a clean context. [`STATUS.md`](../refactor/STATUS.md) tracks them, and each package file says
what it touches, what it depends on and what can run beside it. This section only maps the
phases above to packages; the packages are the source of truth.

| Phase                                                       | Packages      | Wave |
| ----------------------------------------------------------- | ------------- | ---- |
| Set up (branches, size and clone checks, reference outputs) | P00           | 0    |
| R1. Dead code                                               | P01           | 0    |
| R2. Consolidate the basics                                  | P02, P03, P04 | 1    |
| R3. Capabilities and adapters                               | P05–P09       | 2    |
| R3, continued: UI callers onto capabilities                 | P09b–P09d     | 2½   |
| R4. Formats as a strategy table                             | P10           | 3    |
| R5. Card features                                           | P11–P14       | 3    |
| R6. Merge parallel implementations                          | P15, P16, P17 | 4    |
| R7. Split `decks`                                           | P18           | 5    |
| R8. Deck builder UI                                         | P19           | 2–4  |
| R9. Naming and docs; large files left; design docs reviewed | P20, P21, P22 | 5    |

**Branches.** `main` stays shippable. The work happens on `refactor/main`, one branch per package,
and `refactor/main` is **allowed to break**: features may stop working and get rebuilt on the new
architecture. Every breakage is listed in STATUS with the package that will fix it. `refactor/main`
is merged into `main` at three milestones (after waves 2, 4 and 5), each with the full suite
green and the user's approval. The README has the details.

**File size.** 500 lines per source file is the benchmark. A file over it needs a one-line
reason on an allowlist, and `pnpm check` reports the rest (P00). Today 28 source files are over;
each package that owns one splits it, and P20 handles what's left.

**Lessons** for the refactor are deferred: they're in the backlog (STATUS), to plan later. The
packages don't write lessons.

## 8. Test plan

- **Tests are rewritten for the new architecture, not ported.** When code is replaced, its old
  tests are deleted with it, and the package writes new tests against the new design (mostly unit
  tests against fakes, plus integration tests for SQL).
- **Reference outputs, not golden gates.** P00 records what the 16 LLM tools return today and a
  checklist of every feature. Rebuilt features are compared with them, and deliberate differences
  are written in the package's handoff.
- **Each consolidation** (section 4.2, step 2) starts with a test that runs every copy on the
  same edge cases. Where they disagree, the user's decision becomes the expectation.
- **Merge gate** for each package: typecheck, lint, the size and clone checks, and the package's
  own tests. Known failures elsewhere are listed in STATUS. **Milestones** need the full suite
  green: `pnpm check`, `pnpm test:int`, `pnpm test:e2e`.

## 9. Open questions for you

The decisions needed before blocked packages can start are listed, and answered, in
[STATUS.md](../refactor/STATUS.md#decisions-needed-ask-the-user-record-the-answer-here): the
double-faced land rule (P04), the mana curve (P16), card features storage (P11), how to split
`decks` (P18), and which removed tools to bring back (P01).

## 10. Change log

Newest first. One line per change: the date, what changed and why, and the package or
conversation that changed it.

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | By                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 2026-11-19 | Plan revision (`docs/refactor/reviews/plan-review/`): five read-only reviews found the plan as written would end near 78,000 to 79,000 code lines, not 73,000, because new layers were added beside old code and estimates came without deletion lists. New packages P23–P34 (guards and test fixes, dead code and the interactive goldfish, the secure read layer, shared card types, one scorer with no scores in tools, "can I cast X by turn Y", import cycles, merged collections and split catalog, UI blocks, page states, accessibility, repo polish). P11–P15, P18 and P20–P22 re-scoped (P12–P14 sliced by ability). New wave order 3a, 3b, 4, 5, 6. Target: ≤ 75,000 code lines (stretch ≤ 72,000), test support counted apart. Process: a code-line ratchet, a deletion list before approval, delete in the same commit, stronger checks, the PM checks each list against the diff. The owner approved the plan and answered the philosophy questions | plan review, five agents          |
| 2026-11-19 | Milestone 1 review (`docs/refactor/reviews/milestone-1.md`): wave 2 moved the tools onto capabilities but no UI caller, so it grew about 900 lines instead of removing about 3,000. Added wave 2½ (P09b–P09d): per-module `wiring.ts`, a `readPage()` helper, a lint ratchet on `getContainer` in `src/app`, and every action and page moved. P10, P11 and P17 now wait on P09c; deferrals must edit the receiving package                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | conversation (milestone 1 review) |
| 2026-11-19 | The design docs were written one feature at a time: their product rules mostly hold, but their layout sections planned the duplication, many change one subsystem without saying so, and 8 were self-approved. Added: packages read their group's docs' rules first and mark replaced docs "Superseded in part" (playbook Part A: "read the rules" before step 1, and step 15; a doc map per group), and P22 consolidates the rules into `docs/modules/` and archives superseded docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | conversation (design doc review)  |
| 2026-11-19 | Added 4.2½ (savings ranked by lines, re-measured after P04) and the dedup playbook (`docs/refactor/dedup-playbook.md`) with a recipe per group; noted that ≤ 80,000 is now a stretch. Tests: the unit and integration suites can't reach the network (`tests/setup/no-network.ts`), and the README says which suites to run when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | conversation (dedup review)       |
| 2026-11-18 | Responsibilities can nest: a module may group related responsibilities as subfolders, with `research/{reddit,youtube}` as the model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | review with the user              |
| 2026-11-18 | Dropped the feature review: only redundant code is removed. The layout is by responsibility (modules plus layer folders), not feature folders                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | review with the user              |
| 2026-11-18 | Added "The end state": size and structure targets, the target tree, injection rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | review with the user              |
| 2026-11-18 | Split the plan into work packages (`docs/refactor/`), with branches and the 500-line benchmark; lessons moved to the backlog                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | review with the user              |
| 2026-11-18 | Added section 4, the duplication catalogue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | review with the user              |
| 2026-11-18 | Tools become thin bindings over module capabilities (F2, R3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | review with the user              |
| 2026-11-18 | First draft of the audit and plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | audit session                     |
