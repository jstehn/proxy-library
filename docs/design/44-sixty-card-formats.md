# Design: 60-card formats (playsets, sideboard, legality, role targets)

- **Phase:** 44 (tududi task `#52`, project "Build decks from owned cards")
- **Status:** **Approved** (2026-11-11 — continuing Project #11 roadmap per user confirmation)
- **Related:** design doc 09 (decks & rules), design doc 19 (builder insights & role targets), design doc 20 (suggestions), design doc 28 (LLM tool API), design doc 35 (mana base planner), design doc 37 (`draft_deck`), design doc 40 (`apply_changes`)
- **Lesson:** no (extends existing constructed-format rules, role targets, multi-copy drafting, and MCP/builder visibility across all 60-card formats)

## 1. Purpose & scope

The rules engine (`src/modules/decks/domain/rules.ts`) already recognizes `standard`, `pioneer`, `modern`, `legacy`, `vintage`, `pauper`, and `casual` alongside `commander` and `limited`. However, the rest of the deck-building stack was built primarily around 100-card singleton Commander:

1. **No 60-card role targets.** `roleTargets(format)` returns `null` for all non-Commander formats, disabling role progress bars in the builder, role gaps in `deckSuggestions`, role keep/cut scoring in `rankCuts`, and role targets in `get_deck` and `apply_changes`.
2. **Playsets (multi-copy support) are incomplete in drafting and building tools.**
   - `draftDeck` / `draftForDeck` / `draft_deck` reject every non-Commander deck and assume 1 copy per drafted spell (`DraftedSpell` has no `quantity`, `room` is hardcoded to singleton).
   - `suggestionContext` (`queries/suggestions.ts`) hides any card already in the deck from `suggest_for_deck`, even in 60-card formats where 1–3 copies leave room for a 4-card playset.
   - `SelectedCard` in the web builder offers `1..99` without playset awareness (`X/4`, quick `"Fill to 4"` button, or an immediate warning before saving >4 copies).
3. **Sideboard & format rules visibility are thin.** `deckStats` does not expose `sideboardCount`, so neither `StatsPanel` nor `get_deck` reports sideboard usage (`0–15`) at a glance.
4. **Cross-format legality checks for Standard, Pioneer, Modern, Legacy, Vintage, and Pauper.** While `deckProblems` checks the deck's chosen format, `get_deck` does not report which of the 60-card constructed formats (`CONSTRUCTED_60_FORMATS`) the deck's current card pool and copy counts satisfy.

**Out of scope:** format-specific sideboard swap guides ("in vs aggro / out vs control"), Companion zone rules, 1v1 competitive metagame tier lists, or changing Limited (40-card) rules (Limited still keeps `roleTargets === null` and no copy cap).

## 2. Ubiquitous language

| Term                | Meaning in this codebase                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Constructed 60      | `standard`, `pioneer`, `modern`, `legacy`, `vintage`, or `pauper` (`CONSTRUCTED_60_FORMATS`): 60+ main, <=15 side, 4-of limit. |
| 60-card format      | Constructed 60 plus `casual` (`deckSize(format).cards === 60`).                                                                |
| Playset             | Up to 4 copies of a non-basic, non-unlimited, non-restricted card across main deck + sideboard (`copyLimitFor`).               |
| 60-card role target | Baseline guide (`ramp: 4, draw: 6, removal: 6, wipe: 2`) for 60-card formats (`roleTargets`).                                  |
| Card-legal formats  | Constructed 60 formats where every counted card in the deck passes legality and copy-limit checks (`legalFormatsForCards`).    |

## 3. Domain model & pure functions

### 3.1 `src/modules/decks/domain/stats.ts`

1. Add `sideboardCount: number` to `DeckStats`: counts `line.quantity` where `line.board === "side"` (still excluded from `cardCount`, `curve`, `types`, `pips`, `sources`, `tags`, and still included in `priceCents`).
2. Add `SIXTY_CARD_ROLE_TARGETS`:
   - `ramp: 4, draw: 6, removal: 6, wipe: 2` (18 role slots out of ~36 non-land spells — the same ~50% heuristic proportion as Commander's 31/62, using natural playset/half-playset counts).
3. Update `roleTargets(format: string)`:
   - `"commander"` -> `{ ramp: 10, draw: 10, removal: 8, wipe: 3 }`
   - `"limited"` -> `null`
   - All 60-card formats (`"standard"`, `"pioneer"`, `"modern"`, `"legacy"`, `"vintage"`, `"pauper"`, `"casual"`) -> `SIXTY_CARD_ROLE_TARGETS`.

### 3.2 `src/modules/decks/domain/rules.ts`

1. Export `CONSTRUCTED_60_FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "pauper"] as const`.
2. Export `FormatRulesSummary` and `formatRulesSummary(format: Format)`:
   - Returns `{ minMainCards: number; exactSize: boolean; maxCopies: number | null; maxSideboard: number | null }`.
   - Note: `commander` -> `{ minMainCards: 100, exactSize: true, maxCopies: 1, maxSideboard: null }` (`maxSideboard` stays `null` to match existing Commander problem checks where sideboard overflow isn't enforced); `limited` -> `{ minMainCards: 40, exactSize: false, maxCopies: null, maxSideboard: null }`; `casual` -> `{ minMainCards: 60, exactSize: false, maxCopies: null, maxSideboard: null }`; Constructed 60 -> `{ minMainCards: 60, exactSize: false, maxCopies: 4, maxSideboard: 15 }`.
3. Export `copyLimitFor(format: Format, card?: Pick<CardRules, "isBasicLand" | "text" | "legalities">): number | null`:
   - If `card && isUnlimited(card)` -> `null` (unlimited).
   - If `card && card.legalities[format] === "restricted"` -> `1` (e.g., Vintage restricted).
   - Else `formatRulesSummary(format).maxCopies` (`1` for commander, `4` for Constructed 60, `null` for `casual` and `limited`).
4. Export `legalFormatsForCards(deck: DeckToCheck, rules: RulesLookup): Format[]`:
   - Evaluates counted entries (`isCounted`: main + sideboard) against each format in `CONSTRUCTED_60_FORMATS`:
     passes iff `legalityProblems(candidateFormat, copies, rules).length === 0` AND `copyLimitProblems(copies, rules, 4).length === 0`.
   - Tells 60-card builders mid-brew (and on complete lists) which of Standard, Pioneer, Modern, Legacy, Vintage, and Pauper their cards and copy counts satisfy.

### 3.3 `src/modules/decks/domain/draft-deck.ts`

Extend `draftDeck` to support both Commander (singleton) and 60-card formats (playsets):

1. `DraftCandidate` gains optional `isRestricted?: boolean` and `maxCopies?: number` (when omitted, inferred from `format === "commander" ? 1 : 4` unless `"a deck can have any number of cards named"` in `text` -> `99`).
2. `DraftedSpell` gains `quantity: number` (`1` in Commander; `1..4` in 60-card formats).
3. Copy-budget calculation per candidate:
   - `already = input.inDeck.get(candidate.oracleId) ?? 0`
   - `limit = candidateCopyLimit(candidate, input.format)`
   - `maxAdditional = Math.max(0, limit - already)`
   - For owned picks, additional owned copies available for this deck without going short = `Math.max(0, candidate.ownedCopies - already)` (capped by `maxAdditional`). Wait: if a deck is drafted purely from owned cards that are already partially in the deck, we never count the same owned copy twice!
   - A candidate is tracked by remaining headroom across steps (`addedCountByOracleId: Map<string, number>`):
     - **Step A / B (`role` picks):** take up to `Math.min(room, deficit, remainingSlots)` copies (at least 1 when deficit >= 1), so e.g. 4 _Lightning Bolts_ fill 4 of 6 removal slots while 2 wipes don't over-fill a wipe target of 2.
     - **Step C / E (`plan` / `curve` picks):** take up to `Math.min(room, remainingSlots)` copies (assembling natural playsets up to `4` where owned/store allow), merging multiple steps picking additional copies of the same card into one `DraftedSpell` entry cleanly (`sum(spell.quantity)`).
4. Reconciling spells + mana base (`targetTotal` = 60 in 60-card, 100 in Commander):
   - Total non-basic owned land capacity sums `Math.max(0, Math.min(copyLimit(format), land.ownedCopies) - inDeck)` across non-basics.
   - Total drafted spell copies + `plannedLandAdditions` + `existingCount === targetTotal` whenever sufficient candidates and basics exist; trimming excess spells reduces/removes from the end cleanly.
5. `planManaBase` (`src/modules/decks/domain/mana-base.ts`):
   - Already uses `copyLimit(format) = format === "commander" ? 1 : 4`. Tighten `copyLimitForLand(format, land)` so `limited` has no 4-of cap if ever planned and Vintage restricted utility lands cap at `1`.

## 4. Invariants

1. **Commander & Limited compatibility:** `roleTargets("commander")` stays `{ ramp: 10, draw: 10, removal: 8, wipe: 3 }`; `roleTargets("limited")` stays `null`; `draftDeck` on `"commander"` produces identical singleton (`quantity: 1`) drafts; Commander problem checks remain unchanged.
2. **Playset consistency:** No drafted spell exceeds `copyLimit - alreadyInDeck` across `draftDeck` and `planManaBase`; Vintage restricted cards never exceed 1 copy across `draftDeck`, `planManaBase`, `legalFormatsForCards`, and `rules`.
3. **Sideboard accounting:** `stats.cardCount` strictly counts `isPlayed` (`main + commander`); `stats.sideboardCount` strictly counts `board === "side"`; `maybe` stays excluded from both.
4. **Total draft arithmetic:** `roleSummary[].ownedAdded` and `storeAdded`, `ownedAddedCount`, `storeAddedCount`, `storeCostCents`, and `totalAfterDraft` weight each drafted spell by `spell.quantity`.

## 5. Queries, UI & MCP surface

1. **Queries (`src/modules/decks/queries/`):**
   - `queries/draft-deck.ts`: allow all non-`limited` formats (`commander` still requires a commander line; 60-card formats draft straight to 60 cards without requiring a commander). Mark `is_restricted = (p.legalities->>${context.format} = 'restricted')` and avoid excluding cards with `< copyLimit` already in deck on 60-card formats (let `draftDeck` respect `inDeck` headroom cleanly).
   - `queries/suggestions.ts`: for non-singleton formats (`limit = 4`), `context.inDeck` only excludes cards already at their format copy limit (`quantity >= (isRestricted ? 1 : 4)` unless unlimited), rather than excluding cards at 1–3 copies, and `toCard` reports accurate `inThisDeck` count! (`suggest_similar` still excludes the target card itself.)
   - `queries/mana-base.ts`: exclude `limited` restricted checks consistently; already allows up to 4 copies of owned non-basics.
2. **Web UI (`src/app/decks/[id]/builder/`):**
   - `StatsPanel` (`stats-panel.tsx`): shows `Sideboard: X / 15` when `formatRulesSummary(props.format).maxSideboard !== null`, and updates the role targets caption cleanly between Commander and 60-card formats.
   - `SelectedCard` (`selected-card.tsx`): shows copy limit context (`X / 4` when `copyLimit` applies), quick `"Fill to 4"` playset button when `copyLimit === 4 && currentMain < 4`, and warns inline when `countedInDeck + props.quantity > copyLimit`.
   - `DeckBuilder` & `DraftPanel`: show `"Draft deck"` for all non-`"limited"` decks using `deckSize(format).cards` instead of hardcoded `100`, render `spell.quantity` (`4x Lightning Bolt`), and submit `spell.quantity` when adding drafted spells.
3. **MCP tools (`src/app/_llm-tools/tools/decks.ts`, `registry.ts`):**
   - `get_deck`: includes `stats.sideboardCount`, `formatRules: formatRulesSummary(format)`, updated `roleTargets` description (works for both Commander and 60-card formats), and for non-commander/non-limited decks includes `cardLegalIn: legalFormatsForCards(...)`.
   - `draft_deck`: removes the `NotCommanderDeck` restriction for 60-card decks (refuses `LimitedDeck` for `"limited"` and `CommanderMissing` for `"commander"` without a commander), updates role-target default descriptions, and includes `quantity` on each drafted spell.

## 6. Verification plan

1. Unit tests (`src/modules/decks/domain/stats.test.ts`, `rules.test.ts`, `draft-deck.test.ts`, `mana-base.test.ts`):
   - Verify `sideboardCount`, 60-card `roleTargets`, `formatRulesSummary`, `copyLimitFor`, `legalFormatsForCards`.
   - Verify `draftDeck` on `standard` / `modern` / `vintage` creates multi-copy playsets (`<= 4`, `<= 1` for restricted, `inDeck` headroom respected) totaling 60 cards and accurate `roleSummary` + costs.
2. Integration tests (`tests/integration/draft-deck.int.test.ts`, `suggestions.int.test.ts`, `src/app/_llm-tools/llm-tools.int.test.ts`):
   - Verify Standard / Pioneer / Modern 60-card deck creation, playsets, sideboard limits, legality (`NotLegal` vs `cardLegalIn`), 60-card role targets in `get_deck` and `suggest_for_deck`, and 60-card `draft_deck` end-to-end.
3. Full `direnv exec . pnpm check` and integration suite.
