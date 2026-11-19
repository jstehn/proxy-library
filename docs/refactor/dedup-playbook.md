# Deduplication playbook: where the savings come from

This is the "how" behind [doc 65, section 4](../design/65-codebase-audit-and-refactor.md#4-duplication-the-same-job-written-many-times).
It ranks the duplication that's left by how much code it removes, and gives every group a recipe
you can follow step by step. Your package file links to its section here. **Read Part A once, then
only your group's section in Part B.**

Numbers were measured on `refactor/main` at `57f01ed` (after P04), 2026-11-19. Recheck them with
the commands in each section before you start: other packages may have moved things.

## Measured so far

| Package | Source lines before | After  | Change | Notes                                                                    |
| ------- | ------------------- | ------ | ------ | ------------------------------------------------------------------------ |
| P01     | 93,743              | 91,061 | −2,682 | Dead tool wrappers and `knip` (less than the −3k to −5k hoped)           |
| P02–P04 | 91,061              | 91,358 | +297   | Fixed disagreements (types, prices, lands); new fragments and lint rules |

P02–P04 were about **correctness** (one answer per question), not size. The size comes from the
groups below, and almost all of it from the first three.

## The ranking

"Today" is the lines in the files that hold the copies. "Removable" is an estimate of what the
merge deletes, after adding the new shared code. Confidence says how sure the estimate is.

| Rank | Group                                                | Today                                                        | Removable                   | Packages | Confidence |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------ | --------------------------- | -------- | ---------- |
| 1    | [S1. Tools and adapters compose the same reads](#s1) | 6,083 (`_llm-tools`) + 1,225 (deck server actions)           | **−3,000 to −4,000**        | P05–P09  | high       |
| 2    | [S2. Queries that do a service's job](#s2)           | 4,786 in 16 files with candidate SQL; `suggestions.ts` 1,030 | **−1,200 to −1,800**        | P06, P07 | medium     |
| 3    | [S3. Reading oracle text](#s3)                       | about 4,800 in 11 files                                      | **−1,000 to −1,800**        | P11–P14  | medium     |
| 4    | [S4. Four opening-hand engines](#s4)                 | 1,619 in 4 files, plus `draw_sample` (150)                   | −500 to −800                | P15      | high       |
| 5    | [S5. Collections and offers](#s5)                    | 1,172 in 6 files (16 clone runs)                             | −350 to −500                | P07, P17 | high       |
| 6    | [S6. Format checks](#s6)                             | 54 checks in 29 files                                        | −150 to −300                | P10      | medium     |
| 7    | [S7. Error text](#s7)                                | `messageFor` ×9, inline `Record<string, string>` maps        | −150 to −250                | P09      | high       |
| 8    | [S8. Mana curve](#s8)                                | 4 bucket schemes                                             | −50 to −100                 | P16      | high       |
| 9    | [S9. Builder UI](#s9)                                | `deck-builder.tsx` 1,457, `deck-list.tsx` 596                | −300 to −800                | P19      | low        |
| 10   | [S10. Small clones no package owns](#s10)            | 10 clone runs in social, catalog, wallet                     | −100 to −200                | P20      | high       |
|      | **Total**                                            |                                                              | **about −6,800 to −10,500** |          |            |

**What this means for the target.** From 91,358, the total lands between about 80,900 and 84,600.
Doc 65's target of ≤ 80,000 is reachable only at the top of every range. Treat the target as a
direction: report your package's real number, and if you find more redundancy than your section
lists, say so in the handoff.

## Part A: how to merge one duplicate (every group)

Doc 65 section 4.2 gives the five steps. This is the same thing as a checklist, with the mistakes
to avoid. Do it **one group at a time**, in your package's order.

### A1. Before writing anything

**First, read the rules the copies must keep.** Find your group in
[the design docs behind each group](#docs-behind-each-group) and read only these sections of
each doc: **Invariants**, **Decisions** (or the decisions in its Status line) and **Out of
scope**. Write the rules that still apply as a short list in your package's handoff. The merged
version must keep every one; if two docs disagree, that's an A2 disagreement (step 5). Skip the
docs' sections about files, ports and queries: they describe the layout the refactor replaces.

1. Run your section's **inventory command**. Paste its output into your package's handoff (or a
   tududi comment) so the next session can see what you started from.
2. For each copy, write one line: file, function, what it takes, what it returns, and anything it
   does that the others don't (a filter, a rounding, a special case). A table is fine.
3. Ask the **same-job test** for each pair: _"If the rule changed tomorrow, would both have to
   change?"_ Yes → one job, merge it. No → different jobs that look alike; leave them, and give
   them names that say how they differ. If you can't tell, ask the user; don't guess.

### A2. Pin the behaviour

4. Write a test that feeds **every copy** the same inputs, including the edge cases your section
   lists, and records what each returns. Run it against the old code first.
5. Where copies disagree, stop. Write the disagreement in a tududi comment on your package's task,
   with the inputs and both answers. Pick the answer the section says, or ask the user if it
   doesn't say. Record the decision in the package file.

### A3. One home

6. Write the single version where the section says. If the boundary lint (ADR 0009) blocks that
   place, use the nearest allowed one (P02–P04 all had to: see their handoffs) and say why in a
   comment at the top of the file.
7. The single version takes **data**, not flags. If you find yourself writing
   `doThing(input, { mode: "builder" | "draft" })`, the modes are either one rule (drop the flag)
   or different jobs (two named functions, or a strategy table: `Record<Mode, Strategy>`).
8. Its test is the A2 test, now with one expected answer per input.

### A3½. What not to do

| Don't                                                      | Why                                                          | Instead                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Leave the old function as a wrapper that calls the new one | That's a second name for one job: the next feature picks one | Change the callers; delete the old function                             |
| Re-export it from the old place "for compatibility"        | Same as above                                                | Move the imports (P04 kept one re-export in `stats.ts`; P18 removes it) |
| Put it in a `utils.ts` or `helpers.ts`                     | Nobody can find it from the tree                             | The module and file that own the rule, named for the rule               |
| Add an optional parameter for each caller's special case   | It becomes a function of flags                               | A7: one rule, or named strategies                                       |
| Port the old tests line by line                            | They test the old shape                                      | Write tests for the new function; delete the old tests with the code    |
| Fix an unrelated bug you notice                            | The package grows and can't be reviewed                      | A tududi task in the project, `related_to` your package                 |
| Merge two things because they look alike                   | Accidental similarity: they'll split again                   | The same-job test (A1, step 3)                                          |

### A4. Move callers, delete copies

9. Change **every** caller, one commit per group: "P07: one candidate pool (S2)". A copy left
   behind "for now" is how this codebase got here.
10. Delete the old copies and their tests in the same commit.
11. Run the inventory command again. It must list only the new home. Run `pnpm clones` (the count
    must not go up; lower the baseline with `pnpm clones --update` when it goes down) and
    `pnpm sizes` (note the source line total).

### A5. Guard it

12. Add the lint rule your section names (`no-restricted-syntax` in `eslint.config.mjs`, with a
    message that names the new home). Check it fires: add a copy, run `pnpm lint <file>`, see the
    error, remove the copy.
13. Add a row to the "where does this live?" table in `docs/architecture/conventions.md`.
14. Comment on your tududi task: the group, the commit's short SHA, lines before and after, and
    any disagreement you settled.
15. **Mark the design docs.** In each doc from your group whose code you replaced, add one line
    under its Status line:
    `- **Superseded in part** (2026-11-…, P07): section 9's candidate queries → decks/queries/candidate-pool.ts (doc 65, S2).`
    Don't edit the rest of the doc: it records why the feature was built that way. A doc whose
    rules all still hold needs no line. P22 uses these lines to sort the docs.

<a id="docs-behind-each-group"></a>

### The design docs behind each group

A starting list from the docs' titles and a keyword search (2026-11-19). If you find a doc that
belongs to your group, add it here.

| Group                          | Design docs (`docs/design/NN-*.md`)                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| S1. Tools and adapters         | 28 (LLM tools), 30 (OAuth for connectors), 40 (dry-run changes), 56, 57, 60, 61, 64; the builder side: 14, 19   |
| S2. Candidates and suggestions | 15, 20, 29, 35, 36, 37, 39, 46, 47 (rating tuning and swaps), 53, 54, 55, 57                                    |
| S3. Oracle text                | 19 (roles), 25 (token proxies), 31 (brackets), 38 (tags and themes), 42, 46, 52, 58, 59, 60 (simulator plugins) |
| S4. Opening hands              | 19 (test hands), 43, 56, 58, 60                                                                                 |
| S5. Collections and offers     | 06, 07, 16, 26, 33 (MSRP pricing), 51                                                                           |
| S6. Formats                    | 09, 14, 31, 40 (partner rules), 44, 61                                                                          |
| S7. Error text                 | 28 (tool errors); the rest is in ADR 0026 and conventions.md                                                    |
| S8. Mana curve                 | 14, 17 (the drafter), 19, 37, 55                                                                                |
| S9. Builder UI                 | 14, 19, 23, 24, 32, 34, 41, 59                                                                                  |
| S10. Small clones              | 03 (wallet), 45 (EDHREC), 48 (social profiles and friends)                                                      |
| P14: lands and draft abilities | 17, 18 (Conspiracy drafts)                                                                                      |

---

<a id="s1"></a>

## S1. Tools and adapters compose the same reads (P05–P09)

**The biggest win.** Three kinds of adapter each build the same answers from module functions by
hand:

- **The internal tools** (`_llm-tools/tools/decks.ts` 2,145 lines, `library.ts` 747,
  `search.ts` 277, `wishlist.ts` 243): about 45 `defineTool` definitions, each with its own Zod
  schema, its own composition of queries and its own output shaping.
- **The public tools** (`tools/consolidated.ts`, 979 lines): the 16 tools the model sees. Each one
  calls 2–5 internal tools through `.run()` and then rewrites their output (`stripProvenance`,
  `compactMoneyFields`). That's an adapter calling adapters.
- **The server actions** (`app/decks/[id]/builder/actions.ts` 842, `app/decks/actions.ts` 383):
  the builder needs the same answers, so it composes the same module functions again.

The writes already go through application services (`getContainer().decks.setEntry(actor, …)`).
**The reads don't**: actions and tools call query functions with `getContainer().db` themselves
(`deckView(db, …)`, `browseCollection(db, …)`, `combosForDeck(db, …)`). Both the tools and the
builder call `deckView`, `combosForDeck`, `manaBasePlan`, `similarCards`, `getDeckProfile`,
`deckTokenLines` and `fingerprint`, each with their own glue. The clone check finds the same lines
in `tools/decks.ts` and `app/decks/[id]/page.tsx`.

**Inventory.**

```bash
grep -nE "^export const [a-zA-Z]+ = defineTool|\.run\(context" src/app/_llm-tools/tools/*.ts | wc -l
grep -rc "getContainer()" src/app | grep -v ":0$" | sort -t: -k2 -rn | head
```

**The shape (ADR 0026, built in P05).** One capability per question, in the module's
`application/` layer, taking `actor` and a parsed input and returning a `Result`. Every adapter
calls it:

```
capability  decks/application/deck-overview.ts   makeDeckOverview({ deckView, combosForDeck, … })
   ├─ binding   _llm-tools/bindings/get-deck.ts  input schema + call + present (JSON for the model)
   ├─ action    app/decks/[id]/builder/actions.ts  action(({ actor, capabilities }, input) => …)
   └─ page      app/decks/[id]/page.tsx           capabilities.deckOverview(actor, …)
```

**The mapping.** Each public tool becomes one binding over one or a few capabilities. The column
"UI caller" is the action or page that must call the **same** capability afterwards: that's where
the second copy goes away.

| Public tool                           | Internal tools it calls today                                                    | Capability to write (module)                                                           | UI caller that shares it                          | Package |
| ------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- | ------- |
| `list_decks`                          | —                                                                                | `listDecks` (decks) — done in P05                                                      | `app/decks/page.tsx`                              | P05     |
| `get_account`                         | `getAccount`                                                                     | `getAccountOverview` (accounts) — done in P05                                          | account page                                      | P05     |
| `get_deck`                            | `getDeck`, `deck_facts`, combos, `mana_base_skeleton`, `get_deck_profile`        | `deckOverview(actor, { deckId, include })`, include = facts, combos, manaBase, profile | `loadBuilderDeck`, `app/decks/[id]/page.tsx`      | P06     |
| `search_cards`                        | `analyzeCards`, `semanticSearchForDeck`, `searchForDeck`, `searchCards`          | `searchCards`, `searchForDeck` (on S2's candidate pool)                                | `browseAction`, the builder's search              | P07     |
| `get_cards`                           | `getCard`                                                                        | `cardDetails(ids)` (catalog)                                                           | `cardDetailAction`                                | P07     |
| `find_replacements`                   | `similarCards`, `budgetReplacements`                                             | `findReplacements(actor, { deckId, card, mode })`                                      | the builder's similar-cards and budget actions    | P07     |
| `manage_wishlist`                     | (its own)                                                                        | wishlist capabilities, using `store.quote` (S5)                                        | `app/wishlist/actions.ts`                         | P07     |
| `edit_deck`                           | `replaceDeckList`, `apply_changes` (with the module-level `pendingPreviews` map) | `previewDeckChanges`, `applyDeckChanges` with a `PreviewRepository`                    | the builder's edit-as-text and change actions     | P08     |
| `update_deck`                         | `updateDeck`, `deleteDeck`, `setDeckProfile`, `setPrimer`, `deckSources`         | the existing `decks` commands; one binding that picks by `action`                      | `app/decks/actions.ts`, primer and profile panels | P08     |
| `create_deck`                         | `createDeck`                                                                     | existing `decks.create`                                                                | new-deck action                                   | P08     |
| `draw_sample`                         | its own 150 lines of dealing                                                     | calls S4's opening-hand engine (P15); until then, `draws.ts`                           | test hand                                         | P09     |
| `edhrec_lookup`                       | `compareToEdhrec`, `edhrecCommander`                                             | `edhrecForDeck` (decks, using catalog's EDHREC reader)                                 | builder's EDHREC panel, if any                    | P09     |
| `rules_lookup`                        | `lookupRules`, `checkInteraction`, `getRulings`                                  | catalog rules capabilities                                                             | —                                                 | P09     |
| `find_combos`                         | `findCombosForDeckTool`                                                          | `combosForDeck` as a capability                                                        | `loadBuilderDeck`'s combos                        | P09     |
| `reddit_research`, `youtube_research` | (their own)                                                                      | the existing use cases                                                                 | —                                                 | P09     |

**Steps for each row.**

1. Read the public tool in `consolidated.ts` and every internal tool it calls. List what the
   output contains (the reference output in `docs/refactor/reference/tools/` is the exact JSON).
2. Write the capability: a `make…` factory in the module's `application/`, dependencies as named
   functions (readers), one inner `function`, a `Result`. Unit-test it with fake readers.
3. Wire it in `src/server/capabilities.ts` (one entry).
4. Write the binding in `_llm-tools/bindings/<tool>.ts`: copy the public tool's **description
   and input schema word for word** (the model was tuned against them), `call` the capability,
   and move the output shaping (including what `stripProvenance` and `compactMoneyFields` did)
   into `present`. `present` only reshapes; it never queries.
5. Point the UI caller at the capability through `action()`. Delete its hand-composed version.
6. Compare the binding's output with the reference output. Differences are fine only if they're
   deliberate; list them in the handoff.
7. Delete the public tool, the internal tools it called, and their tests. A binding never imports
   another binding.

**Targets.** `src/app/_llm-tools` from 6,083 to **≤ 2,500** lines; `builder/actions.ts` from
842 to **≤ 350**; `app/decks/actions.ts` from 383 to **≤ 200**; `getContainer()` in `src/app`
from 191 to **one per file, through `action()`**. No file in `bindings/` over about 100 lines.

**Guard.** P05's adapter lint rule (no `getContainer().db` and no query imports in `src/app`).
Add: no import of `tools/` or `bindings/` from another binding.

<a id="s2"></a>

## S2. Queries that do a service's job (P06, P07)

`decks/queries` is 5,693 lines in 24 files. Much of it isn't reading: `suggestions.ts`
(1,030 lines) scores and ranks, and the "cards you could add" SQL (owned and for sale, at the
cheapest printing) is written again in each feature.

**Inventory.**

```bash
grep -rlE "with cheapest|distinct on" src | grep -v test | xargs wc -l | sort -rn
grep -rnE "function (toCandidate|ownedCandidates|storeCandidates|ownedCandidatesForIds|textArray)" src | grep -v test
```

At `57f01ed`: `ownedCandidates` ×2 and `storeCandidates` ×2 (`suggestions.ts`, `commanders.ts`),
`toCandidate` ×3 (`mana-base.ts`, `commanders.ts`, `draft-deck.ts`), `textArray` ×4
(`suggestions.ts`, `mana-base.ts`, `store/queries/shopping-list.ts`, `wishlist/queries/for-sale.ts`).
Clone runs: `mana-base` ↔ `search-for-deck` (4), `deck-combos` ↔ `semantic-search` ↔ `suggestions`
(7), `commanders` ↔ `draft-deck` (2), `browse` ↔ `suggestions` (1), inside `suggestions` (4).

**The shape.**

- `textArray` moves to `src/shared/db` (one function, beside P03's price fragments). Do this first:
  it's ten minutes and removes four copies.
- One `CandidatePool` port in `decks/application/ports.ts`: `owned(filter)`, `forSale(filter)`,
  `byIds(ids)`, returning one `Candidate` type. One SQL implementation in
  `decks/queries/candidate-pool.ts` using P03's fragments. The filter is a type with every option
  the copies use (format legality, colour identity, tags, owned or not, real cards, limit).
- The scoring in `suggestions.ts`, `commanders.ts`, `draft-deck.ts` moves to `application/`
  services that take the pool and call pure `domain/` functions (`suggest`, `rate`).

**Edge cases for the A2 test.** A card owned only in foil; a card for sale only as etched; a card
with no price; a card in another deck (decks share cards: count every owned copy); a real-card
deck (`usesRealCards`); colourless commanders; a split card's colour identity.

**Disagreements to expect.** Which finish counts as "cheapest" (P03 found three variants and kept
them as named fragments: use the same names). Whether cards in the deck already are excluded.

**Targets.** Candidate SQL in one file. `suggestions.ts` gone or under 500 lines. `decks/queries`
under 3,500 lines. Clone count down by about 18.

**Guard.** A lint rule: `with cheapest` and `distinct on (` in template strings only in
`candidate-pool.ts` and `shared/db`.

<a id="s3"></a>

## S3. Reading oracle text (P11–P14)

Rules text is turned into meaning in about 11 files (≈ 4,800 lines), each with its own regexes:
`shared/card-search/tags.ts` (579, 14 regexes), `signals.ts` (518), `primitives.ts` (430),
`decks/domain/sim-pipeline.ts` (779, 20 regexes), `rules.ts` (397, 13), `mana.ts` (228, 13),
`deck-profile.ts` (331, 7), `castability.ts` (343), `playtest-card.ts` (597), `token-proxies.ts`
(312) and a **second** signals system, `decks/domain/signals.ts` (288). Reminder-text stripping is
written in `tags.ts`, `primitives.ts` and `brackets.ts`.

**Inventory.**

```bash
grep -rcE "/[^/ ]{3,}[^/]*/[gimsuy]*\.(test|exec)\(|\.match\(/|\.replace\(/" src/modules src/shared | grep -v test | grep -v ":0$" | sort -t: -k2 -rn
grep -rln "reminder" src | grep -v test
```

**The shape** (P11 writes design doc 66 and ADR 0027 first; this is the outline it starts from):

- `CardFeatures`: one versioned, structured value per oracle card: mana it makes, costs it
  reduces, what it lets you cast and from where, triggers, role tags, themes, signals.
- One **recognizer** per ability: `{ id, recognize(face): Partial<CardFeatures> }` in a registry
  (an array). Each regex lives in **exactly one** recognizer, with a fixture test on real card
  text. A new ability is a new recognizer, not an edit in five files.
- One `withoutReminderText(text)`, used by every recognizer.
- Consumers (simulator plugins, mana analysis, castability, deck profile, tags, signals) read
  `CardFeatures`; none reads oracle text.

**Order** (each is its own package so they can run side by side): P11 the model, storage and the
recognizers moved over unchanged; P12 mana and casting read features; P13 tags, themes and the
two signals systems become one; P14 lands and draft abilities.

**The trap.** Don't "improve" a regex while moving it. Move it, pin it with the A2 test, and
change it in a later commit with its own test. Otherwise you can't tell a move from a fix.

**Targets.** Regex checks on oracle text only in `card-features/recognizers/`. One signals system.
About −1,000 to −1,800 lines, after adding the model.

**Guard.** A lint rule: no `oracleText` / `text` regex outside the recognizers (doc 66 names the
exact pattern).

<a id="s4"></a>

## S4. Four opening-hand engines (P15)

| Engine              | File                    | Lines | Deals | Mulligans | Bottoms       | Keep rule    |
| ------------------- | ----------------------- | ----- | ----- | --------- | ------------- | ------------ |
| Test hand (builder) | `draws.ts`              | 371   | yes   | yes       | by hand       | none         |
| Goldfish game       | `goldfish-session.ts`   | 794   | yes   | yes       | yes           | none         |
| Odds (Monte Carlo)  | `goldfish.ts`           | 336   | yes   | yes       | `bottomCards` | `isKeepable` |
| Mulligan drill      | `mulligan-trainer.ts`   | 118   | yes   | yes       | —             | its own      |
| `draw_sample` tool  | `tools/consolidated.ts` | ~150  | yes   | yes       | yes           | —            |

`isEarlyPlay` and `isEarlyRamp` are word for word the same in `goldfish.ts` and
`mulligan-trainer.ts`; the "keepable hand" rule is written in both.

**The shape.** `decks/domain/opening-hand.ts` (after P18, in the play responsibility):
`deal(library, rng, size)`, `mulligan(hand, rng)` (London), `bottom(hand, count, policy)`,
`isKeepable(hand, policy)`, with `isEarlyPlay` and `isEarlyRamp` once. The four engines and the
tool call it; their own state (the game's battlefield, the drill's score) stays theirs.

**Edge cases.** A hand of 0 lands; 7 lands; a mulligan to 4; a deck smaller than 7 cards; a
double-faced land (counts as a land, decision 1); the same seed must give the same hand in every
engine.

**Targets.** One dealing and mulligan implementation. −500 to −800 lines.

<a id="s5"></a>

## S5. Collections and offers (P07, P17)

The clone check's two biggest pairs outside `decks`:

| Pair                                                                              | Clone runs | Lines     | Package |
| --------------------------------------------------------------------------------- | ---------- | --------- | ------- |
| `collection/queries/collection.ts` ↔ `real-collection/queries/real-collection.ts` | 6          | 230 + 368 | P17     |
| `store/queries/shopping-list.ts` ↔ `wishlist/queries/for-sale.ts`                 | 5          | 112 + 79  | P07     |
| `app/api/export/collection/route.ts` ↔ `app/api/export/real/route.ts`             | 3          | —         | P17     |
| `app/collection/page.tsx` ↔ `app/collection/real/page.tsx`                        | 2          | 137 + 246 | P17     |

**The shape.** The game collection and the real collection are **different tables and stay
that way**; what's shared is how they're read and shown. One read helper that takes the table's
columns (or a small `CollectionSource` with the two implementations), one page component with
props for what differs, one export route handler with a parameter. The store's `quote` is the one
"today's offer" (100% of the latest price for singles); the wishlist calls it.

**Edge cases.** The real collection's extra fields (condition, where it's kept); filters that only
one has; a card in both.

**Targets.** Those 16 clone runs gone. −350 to −500 lines.

<a id="s6"></a>

## S6. Format checks (P10)

```bash
grep -rnE "format (===|!==) \"" src | grep -v test
```

54 checks in 29 files. `FormatRuleSet` already exists (the goldfish game takes one). P10 makes it
the only place: a `Record<Format, FormatRules>` with `satisfies`, so a new format fails to compile
until every rule is filled in. Callers ask a question (`rules.hasCommander`, `rules.deckSize`,
`rules.maxCopies`), never compare the format's name.

**Guard.** Lint: no `format === "<literal>"` outside `format-rules.ts`.

<a id="s7"></a>

## S7. Error text (P09)

```bash
grep -rln "function messageFor\|const messageFor" src
grep -rnE "const messages: Record<string, string>" src | grep -v test
```

Nine `messageFor` functions in server actions, inline `Record<string, string>` maps in the builder
actions, and separate text in each tool. One `describe<Module>Error(error)` per module (in
`application/`), a `switch` on `error.kind` ending in `assertNever`, so a new error kind fails to
compile until it has text. The server action and the binding's `describeError` both call it.
`Record<string, string>` is the mistake: it accepts any key and misses new kinds silently.

<a id="s8"></a>

## S8. Mana curve (P16, needs decision 2)

`stats.ts` (0–7+), `rate.ts` `curveBucket` (0–6), `draft-deck.ts` `curveBucket` ("1–2 / 3 / 4 /
5+"), `app/drafts/[id]/pool.ts` `curveOf`, and the drafter rounds. One `manaCurve(lines, scheme)`;
if decision 2 keeps several schemes, they're named constants, not private functions.

<a id="s9"></a>

## S9. Builder UI (P19)

Mostly a structure job (one 1,457-line component), not a duplication job. The duplication inside
it: state kept twice (in `deck-builder.tsx` and `deck-list.tsx`), and server calls that S1 turns
into one capability each. Do S1 first for the builder's actions; then P19 moves state into one
`useReducer` and splits panels. The estimate is low-confidence: measure as you go.

<a id="s10"></a>

## S10. Small clones no package owns (P20)

From the clone check at `57f01ed`: `social/infrastructure/drizzle-repositories.ts` (3 runs inside
the file), `social/queries/friends.ts` ↔ `profile.ts` (2), `catalog/infrastructure/edhrec-gateway.ts`
↔ `outside-data.ts` (2), `wallet/infrastructure/drizzle-repositories.ts` ↔ `wallet/queries/wallet.ts`
(1), `social/application/update-profile.ts` ↔ `social/domain/profile.ts` (1). Each is a small,
local merge: apply Part A. P20 takes them (tududi has a task).

To list clones by file yourself:

```bash
pnpm exec tsx -e '
import { readFileSync } from "node:fs"; import { execSync } from "node:child_process";
import { findCloneRuns } from "./scripts/clones.ts";
const files = new Map(execSync("git ls-files src worker scripts").toString().split("\n")
  .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f) && !/\/(testing|fixtures)\//.test(f))
  .map((f) => [f, readFileSync(f, "utf8")]));
for (const places of findCloneRuns(files).values()) if (places.length > 1)
  console.log([...new Set(places.map((p) => p.replace(/:\d+$/, "")))].sort().join("  <>  "));
' | sort | uniq -c | sort -rn
```
