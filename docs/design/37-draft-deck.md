# Design: Draft a Deck from Owned Cards (`draft_deck`)

- **Phase**: 37
- **Status**: **Approved** (2026-11-11)
- **Related docs**: [09 — Decks](09-decks.md), [19 — Deck Analysis & Validation](19-deck-analysis.md), [20 — Card Tags & Strategy Guides](20-card-tags-and-guides.md), [28 — LLM Tool Suite](28-llm-tools.md), [31 — Commander Brackets](31-commander-brackets.md), [32 — Card Strength & Deck Suggestions](32-card-strength-and-suggestions.md), [35 — Mana Base Planner](35-mana-base.md), [36 — Commanders I Can Build](36-commanders-i-can-build.md)
- **Lesson**: **no** — reuses the existing functional-core / query-shell split and `planManaBase` / `suggest.ts` scoring; no new architectural pattern introduced.

---

## 1. Purpose & scope

After a player picks a commander — for example by clicking **Start a deck** on `/decks/commanders` (Phase 36), which creates a 1-card deck and opens the builder — they stare at 99 empty slots. Today they can open **Suggestions** (which lists up to 8 cards per tab) and **Mana base** (which needs at least 20 spells before it adjusts for curve), and add cards one tab at a time.

Similarly, when a player asks an AI assistant _"Build me a deck around my Meren from what I own, and tell me what cheap cards I'd need from the store to finish it"_, the assistant has to chain `get_deck`, `suggest_for_deck` across multiple tabs, `search_for_deck`, and `plan_mana_base` to assemble a 100-card list by hand.

Phase 37 adds **Draft a deck** (`draft_deck`): given an existing Commander deck (typically 1–2 commanders, or a partially built list under 100 cards), an optional set of themes/roles to lean into, and optional role targets, it assembles a proposed first draft up to **100 cards**:

1. **Owned cards first.** Decks share cards, so every owned copy counts (`ownedCopies(userId, withReal)`). Owned cards fill missing **role targets** (`ramp`, `draw`, `removal`, `wipe`) first, then **on-plan spells** matching the commander's themes, tribes, and keywords, and finally **on-color playable spells** if the collection's themed pool runs dry.
2. **Store cards only for remaining gaps (and clearly marked).** When owned cards cannot fill the role targets or reach the spell count (or when the player asks to include store fill), the draft fills the remaining spell slots from the catalog's store pool, marking every store card with `pool: "store"` and its `priceCents`, plus a total store cost for the draft.
3. **Lands via `planManaBase`.** Once the spell list is chosen, `draftDeck` calls `planManaBase` (Phase 35) on the combined existing + drafted spells so the land count (`landTarget`) and color-fixing lands match the actual drafted mana curve and mana rocks, landing on **exact 100 cards** (`commanders + spells + lands = 100`).

Like Phases 32, 35, and 36, the draft is **a coarse heuristic starting point, not a finished deck**: it matches regex role/theme tags and mana-value curve buckets without understanding card synergies, combos, or win conditions. **Filling or creating a deck directly from these fill tools without further investigation will likely produce an awful, unfocused pile** (especially `"curve"` section picks, which are merely on-color cards that plug a mana cost). Both the MCP server/LLM tools and the web UI must explicitly warn the model and the player that the draft is only a rough starting skeleton that requires real investigation (`get_deck` oracle text, `analyze_cards`, `search_for_deck` for actual enablers and payoffs, and cutting filler).

### Out of scope

- **Cutting cards from a deck over 100 cards.** When a deck already has 100+ cards, `rank_cuts` (Phase 32) handles cuts; `draft_deck` only fills open slots up to 100.
- **Buying store cards automatically.** Store cards are either left out (via an **Add owned cards only** button) or added to the deck list as unowned entries that appear in `cards_to_get` (Task 47) / the shopping list; the draft never places an order or mutates the collection.
- **60-card formats (`standard`, `modern`, `casual`).** Project 11's scope is Commander until Task 52 ("Consider extending the new tools beyond Commander"). `draftDeck` takes `format` so 4-copy formats can be added in Task 52 without changing the signature.

---

## 2. Ubiquitous language

| Term               | Definition                                                                                                                                                                                                                                                                                      | Where in code                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **DraftCandidate** | A non-land card legal in the deck's format and within the commander's color identity and `targetBracket`, with its tags (`roles`, `themes`), `subtypes`, `oracleText`, `manaValue`, `strength` (0–100), `owned` copies, and `priceCents`.                                                       | `decks/domain/draft-deck.ts` |
| **DraftOptions**   | Optional overrides for a draft: extra `themes` to favor, custom `roleTargets` (defaulting to `roleTargets("commander")`: 10 ramp, 10 draw, 8 removal, 3 wipe), and `includeStore` (`"fill-gaps"` \| `"none"`).                                                                                  | `decks/domain/draft-deck.ts` |
| **DraftSection**   | Why a spell was drafted: `"role"` (fills a role gap toward its target), `"plan"` (matches the commander/deck themes, tribes, or keywords), or `"curve"` (on-color spell that rounds out the mana curve when owned themed cards run out).                                                        | `decks/domain/draft-deck.ts` |
| **DraftedSpell**   | A spell proposed by `draftDeck`: `oracleId`, `name`, `manaCost`, `manaValue`, `typeLine`, `pool` (`"owned"` \| `"store"`), `section` (`DraftSection`), `reasons` (`MatchReason[]`), `priceCents`, and `alsoIn` (`string[]`).                                                                    | `decks/domain/draft-deck.ts` |
| **DeckDraft**      | The complete draft result for a deck: `existingCount`, `targetTotal` (100), `roleTargets`, `roleSummary` (before/after counts for each targeted role), `spells` (`DraftedSpell[]`), `manaBase` (`ManaBasePlan`), `ownedAddedCount`, `storeAddedCount`, `storeCostCents`, and `totalAfterDraft`. | `decks/domain/draft-deck.ts` |

---

## 3. Domain model

Pure TypeScript in `src/modules/decks/domain/draft-deck.ts`. No database, no clock, no I/O; composes `suggest.ts`, `analysis.ts`, and `mana-base.ts`.

### 3.1 Inputs & output types

```ts
export type DraftSection = "role" | "plan" | "curve";

export type DraftCandidate = ScoredCard & {
  readonly manaCost: string | null;
  readonly manaValue: number;
  readonly typeLine: string;
  readonly colors: ReadonlyArray<Color>;
  readonly producedMana: ReadonlyArray<Color>;
  readonly gameChanger: boolean;
  readonly owned: number; // total owned copies (> 0 means owned pool; 0 means store pool)
  readonly priceCents: number;
  readonly alsoIn: ReadonlyArray<string>;
};

export type DraftOptions = {
  /** Extra theme tags to seed into the deck profile (e.g. ["aristocrats", "tokens"]). */
  readonly themes?: ReadonlyArray<CardTag>;
  /** Override default Commander role targets (ramp 10, draw 10, removal 8, wipe 3). */
  readonly roleTargets?: Partial<Record<CardTag, number>>;
  /**
   * Whether store cards can fill slots that owned cards cannot:
   * - "fill-gaps" (default): use owned cards first; use store cards for unmet role targets or empty spell slots
   * - "none": use only owned cards (plus basic lands)
   */
  readonly includeStore?: "fill-gaps" | "none";
};

export type DraftedSpell = {
  readonly oracleId: string;
  readonly name: string;
  readonly manaCost: string | null;
  readonly manaValue: number;
  readonly typeLine: string;
  readonly pool: "owned" | "store";
  readonly section: DraftSection;
  readonly primaryRole?: CardTag;
  readonly score: number;
  readonly reasons: ReadonlyArray<MatchReason>;
  readonly priceCents: number;
  readonly alsoIn: ReadonlyArray<string>;
};

export type RoleProgress = {
  readonly tag: CardTag;
  readonly target: number;
  readonly existing: number;
  readonly ownedAdded: number;
  readonly storeAdded: number;
  readonly total: number;
};

export type DeckDraft = {
  readonly existingCount: number;
  readonly targetTotal: number; // 100 in Commander
  readonly profile: {
    readonly themes: ReadonlyArray<CardTag>;
    readonly tribes: ReadonlyArray<string>;
  };
  readonly roleSummary: ReadonlyArray<RoleProgress>;
  readonly spells: ReadonlyArray<DraftedSpell>;
  readonly manaBase: ManaBasePlan;
  readonly ownedAddedCount: number; // owned spells + owned/basic lands to add
  readonly storeAddedCount: number; // store spells to add
  readonly storeCostCents: number; // sum of priceCents for store spells in `spells`
  readonly totalAfterDraft: number; // existingCount + spells.length + sum(manaBase.add.quantity)
};
```

### 3.2 How spells and `planManaBase` fit together to reach 100 cards

In Commander, `targetTotal = 100`. Let:

- `existingLines` be the cards currently in the `commander` and `main` zones (`existingCount` total copies, split into `existingCommanders`, `existingSpells`, and `existingLands`).
- If `existingCount >= 100`, `draftDeck` returns immediately with `spells: []` and the current `planManaBase` result (`add: []`).

Otherwise, the remaining slots (`100 - existingCount`) must be divided between **new spells** and **new lands**:

1. **Initial spell target from base land count.**
   `landTarget("commander", ...)` starts at `37` lands (`63 - commanders` spells, i.e., `62` spells with 1 commander or `61` with 2). If the deck already has more than 37 lands (`existingLands > 37`), the land budget is at least `existingLands`.
2. **Draft candidate spells in priority order (Section 3.3)** up to a buffer of `maxSpellSlots = 100 - existingCommanders - Math.max(existingLands, 33)` (at most 66 total spells, since `landTarget` is clamped to `[33, 40]`). Each drafted spell is recorded in draft-priority order (most important first).
3. **Reconcile with `landTarget` for an exact 100-card total.**
   Once the candidate spell list is ordered, `draftDeck` finds the prefix of drafted spells of length $N$ such that when `analyseDeck` runs on `existingCommanders + existingSpells + draftedSpells.slice(0, N) + existingLands`, the resulting `desiredLands = Math.max(existingLands, landTarget("commander", stats).lands)` satisfies:
   $$\text{existingCommanders} + \text{existingSpells} + N + \text{desiredLands} = 100$$
   Because `landTarget("commander", stats).lands` is bounded in $[33, 40]$, $N$ is simply `100 - existingCommanders - existingSpells - desiredLands` (typically 61–64 total spells depending on average mana value and mana rocks).
4. **Delegate lands to `planManaBase`.**
   With those $N$ spells fixed, `draftDeck` constructs synthetic `CardLine`s for `existingLines + draftedSpells.slice(0, N)` and calls `planManaBase({ format: "commander", lines, inDeck, owned: ownedLands, basics, store: storeLands, deckRoles, deckThemes })`.
   Because `planManaBase` fills `deficit = Math.max(0, desiredLands - existingLands)` with owned non-basic lands and basic lands in `manaBase.add`, `existingCount + spells.length + sum(manaBase.add.quantity)` equals **100** whenever enough spell candidates and basic lands exist.

### 3.3 Spell selection order (`draftSpells`)

Starting from `lines = existingCommanders + existingSpells`:

1. **Build the initial `DeckProfile`:**
   Call `deckProfile(lines, "commander")` to detect the commander's `themes`, `tribes`, `keywords`, and current role counts (`ramp`, `draw`, `removal`, `wipe`). Merge any user-supplied `options.themes` into `profile.themes` and apply any `options.roleTargets` overrides (defaulting to `{ ramp: 10, draw: 10, removal: 8, wipe: 3 }`).
2. **Partition candidates into `ownedPool` (`owned > 0`) and `storePool` (`owned === 0`), excluding cards already in `inDeck`:**
   Sort helpers break ties deterministically by `score DESC`, `strength DESC`, `priceCents ASC` (for store), `name ASC`.
3. **Step A — Owned role gaps (`section: "role"`, `pool: "owned"`):**
   While any targeted role (`ramp`, `draw`, `removal`, `wipe`) is below its target and spell slots remain:
   - Pick the role with the largest remaining deficit `(target - count)` (tie-broken by `TARGETED_TAGS` order: `ramp`, `draw`, `removal`, `wipe`).
   - Find the highest-scoring card in `ownedPool` that has that role tag, scored by `scoreForRole(card, tag, profile)`.
   - Add the card to `draftedSpells` with `section: "role"`, `primaryRole: tag`, and `reasons` from `scoreForRole`, and increment the role counts for **all** role tags on that card (so a card tagged both `ramp` and `draw` advances both counts).
   - If no remaining card in `ownedPool` has `tag`, mark `tag` as exhausted in `ownedPool` and move to the next role.
4. **Step B — Store role gaps (`section: "role"`, `pool: "store"`, only when `includeStore !== "none"`):**
   If any targeted role is still below its target after `ownedPool` is exhausted for that role:
   - Pick from `storePool` using a budget-aware role score: `scoreForRole(card, tag, profile)` where cards within 10 points of the top fit score prefer lower price (`effectivePrice = Math.max(card.priceCents, 25)`), matching the spirit of `budgetPicks` so a \$0.50 staple beats a \$40 staple of similar fit.
   - Add with `section: "role"`, `pool: "store"`, `primaryRole: tag`.
5. **Step C — Owned on-plan spells (`section: "plan"`, `pool: "owned"`):**
   Recompute `profile` with the role cards included (if the commander itself had no theme tag, themes shared by >= 6 existing + role cards now emerge via `THEME_THRESHOLD`).
   Score remaining `ownedPool` cards with `scoreForDeck(card, currentProfile)` (ignoring already-satisfied role gaps so non-gap roles don't inflate plan scores).
   Take all cards with `points > 0` (matches at least one theme, tribe, or commander keyword), ordered by `points * 100 + strength(card) DESC, name ASC`, up to the spell target.
6. **Step D — Remaining spell slots (owned curve fill vs. store on-plan):**
   If spell slots remain after Step C:
   - First, fill from remaining `ownedPool` spells (`section: "curve"`, `pool: "owned"`), favoring mana values that smooth the curve (slots where the deck has fewer spells among MV $\le 2$, MV $3$, MV $4$, MV $\ge 5$) and higher `strength(card)`, with `reasons: [{ kind: "strength", label: "solid playable" }]`.
   - Second, if `ownedPool` is completely exhausted and `includeStore !== "none"`, fill any remaining slots from `storePool` (`section: "plan"` when `scoreForDeck > 0`, otherwise `"curve"`, `pool: "store"`), ordered by on-plan fit and `strength`.

---

## 4. Invariants

1. **Exact 100-card target.** When the candidate pool + basic lands have enough cards and `existingCount < 100`, `existingCount + draft.spells.length + sum(draft.manaBase.add.quantity) === 100`.
2. **Never exceeds 100 cards.** `totalAfterDraft <= Math.max(100, existingCount)`. If a deck already has 100 or more cards, `draft.spells` and `draft.manaBase.add` are both empty.
3. **Singleton rule respected.** No `oracleId` appears more than once across `existingLines`, `draft.spells`, and non-basic lands in `draft.manaBase.add`. Only basic lands (`Plains`, `Island`, `Swamp`, `Mountain`, `Forest`, `Wastes`) may have `quantity > 1`.
4. **Owned before store.** Every card in `draft.spells` with `pool: "owned"` has `candidate.owned >= 1`. For any role `tag`, no card with `pool: "store"` and `primaryRole: tag` is drafted while an unselected `ownedPool` candidate with `tag` remains and spell slots are available.
5. **Store toggle respected.** When `options.includeStore === "none"`, `draft.spells.every(s => s.pool === "owned")`, `draft.storeAddedCount === 0`, and `draft.storeCostCents === 0`.
6. **Color identity, legality, and bracket respected.** The query shell filters candidates so every drafted card is Commander-legal, within the commander's color identity, not a land (for `draftSpells`), and within the deck's `targetBracket` (when set, via `fitsTarget(bracketLine(c), targetBracket)`).
7. **Deterministic output.** Given identical inputs in any permutation of candidate order, `draftDeck` produces the exact same `DeckDraft`.

---

## 5. Use cases

### 5.1 Read query: `draftForDeck(deckId, userId, options?)`

Lives in `src/modules/decks/queries/draft-deck.ts` (read side — does not mutate the deck):

1. Loads the deck view (`getDeckView(deckId)`) and existing lines (`commander` + `main`).
2. Loads `ownedCopies(userId, withReal)` and `otherDeckNames(userId, deckId)` in parallel.
3. Queries non-land Commander-legal `cards_cache` rows within the deck's color identity, joining `card_tags` and `cheapestPrintings()` for `priceCents`, filtered by `fitsTarget(bracketLine(row), deck.targetBracket)`.
4. Loads the land candidates and basic lands (reusing the land query logic from `queries/mana-base.ts`) and invokes pure `draftDeck(...)`.

### 5.2 Applying the draft: existing `addCards` use case

Phase 35 already added `addCards(actor, { deckId, cards })` to `src/modules/decks/application/manage-decks.ts` and `addCardsAction(deckId, cards)` to `src/app/decks/[id]/builder/actions.ts`.

- Clicking **Add draft to deck (N cards)** in the builder passes all drafted spells (`quantity: 1`) plus `manaBase.add` (`{ oracleId, quantity }`) to `addCardsAction` in a single transaction.
- If the draft includes store spells, the panel shows both **Add owned cards + lands (N)** and **Add full draft including M store cards (\$X.XX)** so the player never adds unowned cards by accident.

---

## 6. Ports

None new. `addCards` uses existing `DeckUnitOfWork`.

---

## 8. Persistence

No schema or migration changes. Reuses `cards_cache`, `card_tags`, `printings_cache`, `collection_items`, `decks`, and `deck_cards`.

---

## 9. Read models (queries), UI & LLM tool

### 9.1 Query shell (`src/modules/decks/queries/draft-deck.ts`)

```ts
export async function draftForDeck(
  deckId: string,
  userId: string | null,
  options: DraftOptions = {},
): Promise<DeckDraft | null>;
```

Returns `null` if the deck does not exist or is not a Commander deck with at least one commander.

### 9.2 Deck builder UI (`src/app/decks/[id]/builder/draft-panel.tsx`)

- In `src/app/decks/[id]/builder/deck-builder.tsx`:
  - Alongside **Suggestions**, **Find cuts**, **Mana base**, and **Test hand** in `<aside aria-label="The deck">`, add a **Draft deck** button (`aria-pressed={draftOpen}`) whenever `deck.format === "commander"` and `deck.commanders.length > 0`.
  - When a Commander deck has fewer than 100 cards, the button label shows the open slot count, e.g. **Draft deck (fill 99)**, making the next step obvious right after clicking **Start a deck** on `/decks/commanders`.
- In `DraftPanel` (`<section aria-label="Deck draft">`):
  - **Heuristic warning banner:** Explicitly warns the player that this draft is a rough heuristic starting point (matching simple tags and mana curve slots without understanding how cards interact), that filling a deck directly with this tool without refinement will produce a weak/awful deck (especially Curve fill picks), and that it requires reviewing card text, searching for real synergies, and cutting filler.
  - **Controls:**
    - Toggle: **Include store cards for gaps** (default on, `"fill-gaps"`, vs `"none"` for owned-only).
    - Summary bar: `Existing: X · Owned spells: +Y · Store spells: +Z ($W.WW) · Lands: +L → Total: 100`.
    - Role progress pills (`Ramp 10/10`, `Draw 10/10`, `Removal 8/8`, `Wipe 3/3`) showing how many came from owned vs. store.
  - **Collapsible sections:**
    1. **Role picks** (grouped or badged by `ramp`, `draw`, `removal`, `wipe`)
    2. **On-plan spells** (with theme/tribe/keyword reason pills)
    3. **Curve fill** (if any)
    4. **Lands (`+L` lands from Mana Base Planner)** — summary of non-basic + basic lands from `draft.manaBase.add`
  - Every card row shows its mana cost, name, reason pill, `also in: <deck>` note (if shared with another deck), and a `store · $X.XX` badge when `pool === "store"`.
  - **Action buttons:**
    - Primary button: **Add draft to deck (N cards)** (or when `storeAddedCount > 0`: **Add full draft (N cards, \$X.XX store)** and secondary **Add owned + lands only (M cards)**).

### 9.3 LLM tool (`draft_deck` in `src/app/_llm-tools/tools/decks.ts`)

Registered in `src/app/_llm-tools/registry.ts` (`scope: "read"`, `readOnly: true`, matching `plan_mana_base` and `suggest_for_deck`):

- **Input schema:**
  - `deckId` (`string`, required): The Commander deck to draft for (must have at least one commander set).
  - `themes` (`string[]`, optional): Extra theme tags to lean into (e.g. `["tokens", "aristocrats"]`).
  - `roleTargets` (`{ ramp?: number, draw?: number, removal?: number, wipe?: number }`, optional): Override default Commander role targets (10 ramp, 10 draw, 8 removal, 3 wipe).
  - `includeStore` (`"fill-gaps" | "none"`, optional, default `"fill-gaps"`): Whether to fill unmet role targets or remaining spell slots with store cards.
- **Output:**
  - `existingCount`, `totalAfterDraft`, `ownedAddedCount`, `storeAddedCount`, `storeCost` (formatted, e.g. `"$4.35"`), `profile`, `roleSummary`, `spells` (each with `oracleId`, `name`, `manaCost`, `typeLine`, `pool`, `section`, `primaryRole`, `reasons`, `price`, `alsoIn`), `landsToAdd` (from `manaBase.add`, with `oracleId`, `name`, `quantity`, `pool`, `reasons`), and a `note` warning the assistant and player that this is a blind tag-and-curve heuristic — filling a deck directly from it will produce a bad deck, so it requires further investigation (`get_deck` oracle text, `analyze_cards`, `search_for_deck` for real enablers/payoffs) before or after applying agreed cards.
- **System instructions (`src/app/_llm-tools/registry.ts`):**
  - Update the deck-building recipe and heuristic warning in `INSTRUCTIONS` so the MCP server knows that `draft_deck` (and the other fill/suggestion tools) is only a coarse heuristic starting point, that filling a deck directly from these tools without investigation will produce an awful deck, and that real deck building requires reading oracle text (`get_deck`), running `analyze_cards` and `search_for_deck` for real enablers/payoffs, replacing curve filler, and telling the player clearly that the raw heuristic draft is only a rough starting point.

---

## 11. Patterns applied

| Pattern                               | Role here                                                                                                                                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Functional Core, Imperative Shell** | `draftDeck` in `decks/domain/draft-deck.ts` is a pure function over in-memory arrays; `draftForDeck` in `decks/queries/draft-deck.ts` loads the deck, collection, and candidate pool from Postgres.                                                  |
| **Algorithm composition**             | Reuses `deckProfile`, `scoreForRole`, `scoreForDeck`, and `strength` from `suggest.ts`, `landTarget` from `analysis.ts`, and `planManaBase` from `mana-base.ts` so role definitions, card scoring, and land counts stay consistent across all tools. |
| **Ideas, not verdicts (Doc 32)**      | The draft never overwrites the deck directly — both the UI panel and the read-only LLM tool present the categorized picks with reasons and prices first, and apply via `addCards` / `replace_deck_list` when confirmed.                              |

---

## 12. Test plan

1. **Domain unit + property tests (`src/modules/decks/__tests__/draft-deck.test.ts`):**
   - **Reaches 100 cards from a 1-commander deck:** Given a commander, a rich owned pool (enough role + theme cards), and basic lands, `draftDeck` produces `spells.length + sum(manaBase.add.quantity) === 99`, `storeAddedCount === 0`, and satisfies all 4 role targets (`ramp >= 10`, `draw >= 10`, `removal >= 8`, `wipe >= 3`).
   - **Owned before store:** When owned cards have 6 ramp cards and store has 10 ramp cards, all 6 owned ramp cards are picked before any store ramp card, and 4 store ramp cards fill the remaining gap with `pool: "store"` and `storeCostCents` summed accurately.
   - **Multi-role card advances both targets:** A card tagged `["ramp", "draw"]` increments both `ramp` and `draw` counts so the draft does not over-pick roles.
   - **`includeStore: "none"`:** Never includes a candidate with `owned === 0`, even when role targets or total spell slots cannot be fully met.
   - **Respects existing deck cards:** Cards already in `inDeck` are never duplicated; existing role counts and existing lands are counted toward targets; a 60-card partial deck only drafts the remaining 40 cards (`spells + lands = 40`).
   - **Curve / mana rock reconciliation with `planManaBase`:** Heavy curve spells increase `manaBase.landTarget.lands` (e.g. to 38–39) and reduce drafted spells to 60–61 so `totalAfterDraft` is still 100; heavy ramp/mana-rock drafts decrease `landTarget.lands` and add spells so `totalAfterDraft` is still 100.
   - **Fast-check property tests:**
     - `totalAfterDraft <= Math.max(100, existingCount)` for arbitrary candidate pools and existing deck sizes.
     - Singleton invariant: no duplicate `oracleId` across `existingLines`, `spells`, and non-basic `manaBase.add`.
     - Determinism: shuffling the candidate pool produces an identical `DeckDraft`.
2. **Integration test (`src/modules/decks/__tests__/draft-deck.integration.test.ts`):**
   - Against real Postgres: seed a commander, owned cards (including cards shared with another deck), store cards with printings/prices, and basic lands.
   - Verify `draftForDeck` respects color identity, `targetBracket` (excludes Game Changers at Bracket 2), counts shared cards from other decks as owned (populating `alsoIn`), and returns a 100-card draft.
   - Verify calling `addCards` with the drafted spells + `manaBase.add` brings the persisted deck to 100 cards.
3. **LLM tool test (`src/app/_llm-tools/__tests__/decks-tools.test.ts`):**
   - Test `draft_deck` returns the structured draft summary, respects `includeStore: "none"` and custom `themes` / `roleTargets`, and errors cleanly if the deck is not found or has no commander.
4. **Playwright E2E (`e2e/decks.spec.ts`):**
   - Open a 1-card Commander deck in the builder → open **Draft deck** → verify role progress, owned vs. store picks, and planned lands render → click **Add draft to deck** → verify the deck reaches 100 cards. Check layout at desktop and 375px mobile width in dark mode.

---

## 13. Open questions (resolved 2026-11-11)

1. **Store fill behavior & ranking:** Approved. Default `includeStore` to `"fill-gaps"` with a one-click toggle in the builder panel to switch to `"none"` (owned only), plus separate **Add owned + lands only** and **Add full draft** buttons when store cards are present. Store picks break close fit ties in favor of lower price (`effectivePrice = Math.max(priceCents, 25)`).
2. **When owned themed + role cards fall short of ~62 spells:** Approved. Fill remaining spell slots from **owned on-color playable spells** (`section: "curve"`, ordered by curve smoothing + `strength`) before pulling non-role store cards, while unmet role targets pull from store when `includeStore === "fill-gaps"`.
3. **LLM tool `draft_deck`:** Approved. Read-only (`scope: "read"`, `readOnly: true`) returning the categorized draft and store cost so the assistant reviews it with the player and applies agreed cards via `replace_deck_list` or `set_deck_entry`.
4. **Lesson (`docs/lessons/`):** Approved **no**.
