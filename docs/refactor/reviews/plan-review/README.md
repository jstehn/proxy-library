# Plan review after wave 4 (approved by the owner, 2026-11-19)

On 2026-11-19, five read-only agents reviewed `refactor/main` at `48f18af`, each from one angle.
Their reports:

1. [Architecture and module boundaries](1-architecture.md)
2. [Code volume and the line target](2-code-volume.md)
3. [The app and UI layer](3-app-and-ui.md)
4. [The domain engines](4-domain-engines.md)
5. [Docs, tests and the first impression](5-docs-tests-dx.md)

The owner's answers so far are in [owner-answers.md](owner-answers.md). This page brings the five
together into a revised plan. **Approved by the owner on 2026-11-19.** The owner's answers (P24: delete all; D1–D5; licence 0BSD; the secure read layer; goldfish removed) are folded in below. After
that, STATUS, the package files and tududi change to match.

## What the reviews agree on

- **The adapter side is good.** Pages, actions and tools are thin, and lint enforces it.
  `getContainer()` is down to 4 calls. Domain code is pure. There are 1,574 unit tests that run in
  12 seconds.
- **The middle is half done.** Capabilities sit beside one-line forward bundles and services passed
  through whole. Decision 3 (a) settles this: reads become an honest query layer.
- **The plan as written can't reach its target.** The remaining packages net about −500 to
  −1,700 lines, ending around 78,000 to 79,000, against a target of 73,000.
- **Why packages grew:**
  - New layers were added beside the old code.
  - Splits added ceremony.
  - Estimates came with no list of what would be deleted.

  Comments aren't the cause: they're about 8% of lines everywhere.

- **The largest savings no package covers:**

  | Work                                        | Lines        |
  | ------------------------------------------- | ------------ |
  | Code production never reaches               | −600 to −900 |
  | The scaffolding that decision 3 (a) removes | −500 to −900 |
  | 51 copies of the same card and row types    | −300 to −500 |
  | A shared form-action helper                 | −300 to −450 |
  | Near-clones that differ only in names       | −400 to −600 |
  | Three scoring models                        | −300 to −500 |
  | Three mana-payment engines                  | −250 to −450 |

- **Things a professional reviewer notices first that no package covers:**
  - No `loading`, `error` or `not-found` pages.
  - No UI building blocks: 1,055 raw colour classes, and one button style copied 13 times.
  - Functions of 572 and 498 lines.
  - No CI and no LICENSE.
  - A flaky end-to-end test (now diagnosed as a test bug).
  - `ctx` used about 250 times.

## Process changes (proposed; they apply from the next package on)

1. **A code-line ratchet.** `pnpm check` fails if code lines rise above
   `docs/refactor/sizes-baseline.txt`. The baseline only goes down. A package that must grow states
   why, and the owner approves it.
2. **A deletion list before approval.** Every package names the files and functions it will
   delete, with line counts. A range like "−300 to −800" with no list isn't accepted.
3. **Delete in the same commit.** A commit that adds a new path (a capability, a recognizer, a
   building block) removes the old path in the same commit. No more "new beside old".
4. **Stronger checks:**
   - `pnpm clones` also finds near-clones (names and literals flattened, 8-line windows).
   - `knip --production` joins the merge gate.
5. **Test support is counted separately.** `pnpm sizes` reports `src/**/testing/` and `fixtures/`
   apart from code lines.
6. **Agents review agents.** Before merging, the project manager checks each package's deletion
   list against its diff.

## The revised order

Waves 0–2½ and P10, P16, P17 and P19 are done. What's left:

### Wave 3a: clear the ground (before any card-features code)

| Id      | Package                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Lines            | Notes                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------- |
| **P23** | **Guards and test fixes.** The process changes above, plus the flaky draft test (it waits for a heading that the last pick never changes) and timeouts for the two property tests.                                                                                                                                                                                                                                                                                                                                                                                                         | small            | first; makes the rest measurable                    |
| **P24** | **Dead and test-only code: delete all of it** (owner, 2026-11-19): the mulligan trainer, card packages, the upgrade roadmap, `deckCombosView`, the rating-evaluation script and its `eval.ts` (keep the weight-fitting script that `rate.ts` names), test-only odds helpers. Also the **interactive goldfish** (D3): `goldfish-session.ts`, `goldfish-sessions.ts` and their wiring.                                                                                                                                                                                                       | −1,500 to −2,200 | owner answered                                      |
| **P25** | **The read layer (decision 3 a), secure by construction.** Per-player queries take the signed-in `Actor`; shared data is checked in SQL; admin reads take the admin actor; integration tests pin each access rule. An ADR 0026 addendum. Pages and actions read through each module's typed queries. Forward bundles and the 17-service pass-through go, and the remaining services become narrow capabilities. `reddit`, `youtube` and `reset` get wiring. One `formAction(schema, …)` helper for FormData actions, and `describe-error` for drafts, wishlist, trades, singles and cards. | −1,100 to −1,800 | replaces P20's "pass-through" and "formAction" rows |
| **P26** | **Shared card and row types.** A few base types (`CardFace`, `DeckLine` and so on) with `Pick`/`Omit` instead of 51 copies. `cardTypes` stays a pure type-line helper, and the 83 raw `/\bLegendary\b/` checks use it.                                                                                                                                                                                                                                                                                                                                                                     | −300 to −500     | cheaper before P18 moves files                      |

### Wave 3b: card features, by ability

| Id          | Package                                                                                                                                                                                                                                                                                                      | Lines                  | Notes                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------- |
| **P11**     | **Card features: model and store** (doc 66 as accepted). Re-scoped: no faces-and-types recognizer (P26 keeps the type-line helper). The first recognizer is one that deletes an old function (tags or tap-mana).                                                                                             | +300 to +600, honestly | adds a regex-count ratchet                                             |
| **P12–P14** | **Recognizers by ability, not by file** (for example "taps for mana" touches `mana.ts`, `castability` and `sim-pipeline` at once). Each slice adds its recognizer, switches every caller, deletes the old code and its tests, and removes the allowlist entry. A slice merges only if its net lines are ≤ 0. | −700 to −1,500         | the four reminder-text strippers and the second signals system go here |

### Wave 4: one engine per job (milestone 2)

| Id      | Package                                                                                                                                                                                                                                                                                                                 | Lines          | Notes                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------- |
| **P15** | **One opening-hand engine and one mana-payment engine** (today there are 3 payment engines, 4 cost parsers and 2 `ManaColor` types).                                                                                                                                                                                    | −650 to −1,150 |                         |
| **P27** | **One scorer.** `rateCard` serves suggestions, cuts and draft-a-deck, with one weight table marked as fitted from data, naming the fitting script. **MCP tools show no scores or ranks**: they list cards as ideas to consider, in compact output that uses few tokens.                                                 | −300 to −500   | owner answered (D1, D5) |
| **P28** | **The simulator answers "can I cast X by turn Y?"** Server-side runs (opening hands and cast-on-curve), with a small effect registry for cost reducers and rituals (Dark Ritual is a test case). Drop the injected options only tests use. Split `draftDeck` (498 lines) and other functions over 100 lines into steps. | −250 to −450   | owner answered (D3)     |

### Wave 5: structure (milestone 3)

| Id      | Package                                                                                                                                                                                                                                                                                                  | Notes                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **P29** | **Untangle before the split.** `ProfileLine` and `StatsLine` move to `stats`. Break the castability↔mana-base and suggest↔suggestion-types cycles, and the accounts↔decks one. Cycle checks cover `wiring.ts`.                                                                                           | small                         |
| **P18** | **Split `decks`** into subfolders (decision 4). They import each other only through each subfolder's `index.ts` (lint). Advice splits into scoring and building, so every folder is ≤ 12 files. Rename `draft-deck` to `build-from-collection`.                                                          | needs the owner (question D4) |
| **P30** | **Merge `collection` and `real-collection`** into one module with game and real parts (design doc 16's money rule kept inside it), and **split `catalog`** into card data, rules lookup and outside deck data. `card-search` keeps only the search language; tags, signals and SQL move to their owners. |                               |

### Wave 6: what a professional sees (polish)

| Id      | Package                                                                                                                                                                                                                                                                                                                                                                                                                                                | Notes          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| **P31** | **UI building blocks and colour tokens.** Button, Field, Select, Card, Table, Dialog, ConfirmButton, Price, EmptyState and FilterBar, migrated area by area.                                                                                                                                                                                                                                                                                           | −600 to −800   |
| **P32** | **Page states and thin pages.** `loading`, `error` and `not-found` at the root and in each big section, plus Suspense for slow reads. Split the 645-line draft page and other large pages. One `paths.ts` per area owns paths and revalidation.                                                                                                                                                                                                        |                |
| **P33** | **Accessibility pass.** Focus styles from tokens, confirmation before destructive actions, a dialog with focus management, and one image component.                                                                                                                                                                                                                                                                                                    |                |
| **P20** | **Large files and near-clones left over**, plus splitting the 1,316-line end-to-end spec and bringing `worker/index.ts` under 150 lines.                                                                                                                                                                                                                                                                                                               | −400 to −600   |
| **P21** | **Naming and docs.** `ctx` becomes a full name. The README's facts get checked, `CLAUDE.md` is trimmed, and the docs index is tidied.                                                                                                                                                                                                                                                                                                                  |                |
| **P22** | **Design docs** into `docs/modules/`, plus a check that the 891 "design doc NN" citations still resolve.                                                                                                                                                                                                                                                                                                                                               |                |
| **P34** | **Repo polish.** A pre-commit hook (fast checks) and CI (GitHub Actions running `pnpm check`); LICENSE **0BSD**, with a code of conduct stating the intent against hateful use; CONTRIBUTING; a README with a screenshot, a diagram, and the AI-authorship note lower down; `scripts/{dev,ops}` with personal tooling moved out; lessons moved to their own repo (ADR 0023 and `CLAUDE.md` updated); `docs/refactor/` archived when the refactor ends. | owner answered |

## Line target

| Plan       | Lines removed          | Ends at                                                              |
| ---------- | ---------------------- | -------------------------------------------------------------------- |
| As written | about −500 to −1,700   | about 78,000 to 79,000                                               |
| Revised    | about −5,000 to −8,500 | about 71,000 to 74,500 (code lines, test support counted separately) |

The proposed commitment is **≤ 75,000**, with **≤ 72,000** as a stretch goal. Clarity wins over line
count where the two conflict (question 8). The ratchet stops growth without forcing cramped code.

## Questions only the owner can answer

**Dead and test-only code (P24).** Keep or delete each one; "no feature cuts" means you decide.

- (a) The mulligan trainer (`mulligan-trainer.ts`, 118 lines, nothing in production uses it).
- (b) Card packages (`packages.ts`, 128 lines; no tool or builder button).
- (c) The upgrade roadmap (`deckUpgradeRoadmap`, about 230 lines; no caller).
- (d) `deckCombosView` (66 lines; no caller; combos reach the deck page another way).
- (e) The rating evaluation script (`eval.ts` and `scripts/eval-ratings.ts`; keep it as a dev tool?).
- (f) The odds helpers only tests use (`deckOdds`, `chanceByTurn`, about 90 lines).

**Domain:**

- D1. Is the hybrid score (`deckFit` + `rateCard`) deliberate, or can one scorer serve all three
  uses?
- D2. Should the type-line helper stay a plain function, with stored features for card text only?
  (Recommended: yes.)
- D3. Is the simulator's plugin injection needed for anything planned, or was it scaffolding?
- D4. Should advice split into scoring and building under decision 4? (Recommended: yes.)
- D5. Were the rating weights fitted from data or tuned by hand?

**Philosophy:** questions 4 to 12 from the first list, and the UI and docs reviews' questions (see
[owner-answers.md](owner-answers.md), "Still open").
