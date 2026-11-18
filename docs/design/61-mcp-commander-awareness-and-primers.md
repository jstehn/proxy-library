# Design: Proxy Library MCP Commander Awareness, Output Caps & Deck Primers

- **Phase:** 61
- **Status:** In review (awaiting review gate approval before implementation)
- **Related ADRs:** 0007 (ACLs), 0016 (client-safe module API), 0023 (design doc sizing)
- **Lesson:** yes (cost-reducer modeling, stateful turn-simulator invariants, response-size budgeting)

## 1. Purpose & scope

Make Proxy Library's MCP simulators, heuristics, and counts commander-aware, cap and paginate large tool responses, and add a structured **Deck Profile & Primer** (stored per deck, editable in the UI and via MCP tools) alongside per-card metadata (`tags`, `role`, `pinned`).

**Out of scope:**
- Changing non-MCP deck export formats (Moxfield/Archidekt text export stays as-is).
- Full multiplayer combat/stack rules engine in `goldfish_*` (goldfish remains a solo turn-by-turn line-of-play simulator).
- Automatic verdict/scoring labels (consistent with Phase 60, `check_interaction` is a rulings + shared-CR lookup, not a verdict).

## 2. Ubiquitous language

| Term | Meaning in this codebase |
| ---- | ------------------------ |
| **Deck Profile** | Structured per-deck metadata (`landTarget`, `roleTargets`, `keyCards`, `avoid`, `costReducers`, `winCons`, `combos`, `plan`, `mulligan`, `pilotNotes`) read by heuristics and MCP tools. |
| **Primer** | Free-form Markdown attached to a deck, supporting `[[Card Name]]` hover links and section-level patching via `set_primer`. |
| **Cost Reducer** | A declarative discount rule in a deck profile (e.g., Henzie: `blitz` −1 generic per command-zone cast; Goreclaw: −2 generic for power ≥ 4). |
| **Goldfish v2** | Stateful solo simulator with mana pool tracking, `keep` / `end_step` actions, `strict` mana enforcement, command-zone cast counting + commander tax, `alt: "blitz"`, and short card keys (`h1`, `b3`). |
| **Response Cap** | ~40 KB UTF-8 JSON ceiling enforced by MCP tool serialization, returning a `next` cursor instead of truncating mid-payload. |

## 3. Domain model

```ts
export type CostReducerScope = "blitz" | "creature_power_gte_4" | "commander" | "all_spells";

export interface CostReducer {
  cardName: string;
  scope: CostReducerScope;
  /** Flat generic mana reduction, or per-cast scaling when perCommandCast is true. */
  genericReduction: number;
  perCommandCast?: boolean;
}

export interface KeyCardPin {
  cardName: string;
  reason: string;
}

export interface AvoidCard {
  cardName: string;
  reason: string;
}

export interface DeckProfile {
  plan: string | null;
  landTarget: number | null;
  roleTargets: Partial<Record<"ramp" | "draw" | "removal" | "wipe", number>> | null;
  keyCards: KeyCardPin[];
  avoid: AvoidCard[];
  costReducers: CostReducer[];
  winCons: string[];
  declaredCombos: string[];
  mulligan: string | null;
  pilotNotes: string | null;
}

export interface CardEntryMetadata {
  tags: string[];      // fixed role tags + custom tags
  role: string | null; // one-line job description
  pinned: boolean;
}

export type ComboDeckStatus = "complete" | "needsMaybe" | "oneAway";

export interface GoldfishStateV2 {
  phase: "opening" | "playing"; // must "keep" before casting; turn 0 blocks casts
  turn: number;
  commandCasts: number;
  manaPool: Record<"W" | "U" | "B" | "R" | "G" | "C", number>;
  /** Short keys (h1, b3, c1, g1) mapped to card instances. */
  keyMap: Record<string, GoldfishCardInstance>;
  endStepQueue: Array<{ key: string; effect: "sacrifice_blitz" }>;
}
```

### Fallback chain for heuristics

Whenever `deck_facts`, `mana_base_skeleton`, `simulate_opening_hands`, `idea_budget_replacements`, or castability checks need a target (`landTarget`, `roleTargets`, `costReducers`):
1. Explicit value in `DeckProfile` (if non-null).
2. EDHREC commander average (if available for the deck's commander).
3. Generic format default.

## 4. Invariants

1. **No pre-keep or turn-0 casts:** `goldfish_step` rejects `cast` while `phase === "opening"` or `turn === 0`.
2. **Strict mana enforcement:** When `strict: true`, `goldfish_step` refuses `cast` if the current `manaPool` (after applying commander tax `2 * commandCasts` and active `costReducers`) cannot pay the spell's mana cost.
3. **Blitz lifecycle:** Casting with `alt: "blitz"` grants haste, enqueues `{ key, effect: "sacrifice_blitz" }` into `endStepQueue`, and `end_step` sacrifices surviving blitzed permanents and draws a card per sacrifice.
4. **KeyCard & Avoid protection:** `idea_budget_replacements` and cut-ranking tools never suggest cutting or replacing a `keyCard` (or `pinned` entry); search and idea tools never suggest adding an `avoid` card.
5. **Role-preserving replacements:** `idea_budget_replacements` only returns candidates sharing at least one role tag with the target card and reports `matchedRole`.
6. **Combo board accuracy:** `find_combos` classifies combos as `complete` only when all pieces are in `main`/`commander` (never `maybe`).
7. **Response ceiling:** No MCP tool response exceeds ~40 KB; oversized list responses return a `next` cursor cleanly.

## 5. Use cases & MCP tools

| Tool / Use case | Actor / authz | Input | Output / Behavior |
| --------------- | ------------- | ----- | ----------------- |
| `get_deck_profile` | Deck viewer | `{ deckId }` | Compact structured `DeckProfile` (a few KB) + fallback summary. |
| `set_deck_profile` | Deck owner | `{ deckId, patch }` | Updates structured `DeckProfile` fields. |
| `set_primer` | Deck owner | `{ deckId, section, content }` | Patches a single Markdown `## Section` (or full primer when `section` omitted). |
| `get_deck` | Deck viewer | `{ deckId, fields?, boards?, includeText? }` | Adds 1-paragraph profile summary at top; filters by `fields`/`boards`. |
| `goldfish_start` / `goldfish_step` | Deck viewer | `keep`, `end_step`, `tap`, `cast { key, alt?, strict? }` | Mana pool, commander tax, blitz, short keys (`h1`, `b3`). |
| `simulate_opening_hands` | Deck viewer | `{ deckId, mustCastBy?: { card, turn } }` | Returns % of hands able to cast `card` (default: commander) by `turn`, counting dorks/rocks/reducers. |
| `find_combos_for_deck` | Deck viewer | `{ deckId, bracket?, limit?, offset? }` | `complete` / `needsMaybe` / `oneAway`, bracket legend (E/P/O/S/R/C), pagination. |
| `get_cards` | Public | `{ names[] }` | Resolves back-face names (e.g. `"Temple of Cultivation"` → Ojer Kaslem). |
| `get_rulings` | Public | `{ cardName }` | Adds `relatedRules` matched from oracle-text patterns (`513`, `118.9`, `400.7`, etc.). |
| `check_interaction` | Public | `{ cards[] }` | Returns each card's rulings + shared CR sections across their texts (lookup only). |

## 6. Persistence

Extend `src/modules/decks/infrastructure/schema.ts`:
- On `decks`:
  - `profileJson` (`jsonb`, nullable) storing `DeckProfile`
  - `primer` (`text`, nullable) storing Markdown primer text
- On `deck_entries`:
  - `tags` (`text[]` / `jsonb`, default `[]`)
  - `role` (`text`, nullable, max 160 chars)
  - `pinned` (`boolean`, default `false`)

Migration generated via `drizzle-kit` with safe defaults (`NULL` / `[]` / `false`) so existing decks require no backfill.

## 7. Server instructions & UI

- **MCP Server instructions** (`src/app/_llm-tools/registry.ts`):
  `"Read the deck profile (get_deck_profile) before suggesting changes; never suggest cutting a keyCard or adding an avoid card."`
- **Deck Builder UI**:
  - Primer tab/panel with `[[Card Name]]` hover card previews and section-based editing (`Plan`, `How it wins`, `Key cards`, `Mulligan`, `Turns 1–3 / 4–6 / late game`, `Watch out for`).
  - Structured profile editor (`winCons`, `keyCards`, `avoid`, `declaredCombos`, `mulligan`, `pilotNotes`).
  - Per-card `role` tooltip on hover, `pinned` toggle, and tag filter bar.

## 8. Test plan

- **Domain unit/property tests (TDD):**
  - `DeckProfile` fallback resolution, `CostReducer` math (Henzie scaling, Goreclaw power check).
  - `GoldfishStateV2` transitions: pre-keep/turn-0 rejection, `strict` mana checks, commander tax, `blitz` + `end_step` sacrifice/draw, short-key stability.
  - `mustCastBy` Monte Carlo simulation with seeded `Rng`.
  - `find_combos` status classification (`complete` vs `needsMaybe` vs `oneAway`).
  - `relatedRules` & `check_interaction` pattern matching; ~40 KB response capper + `next` cursor.
- **Application / integration tests:**
  - `get_deck_profile`, `set_deck_profile`, `set_primer`, `get_deck` filtering, `get_cards` back-face lookup, `idea_budget_replacements` role + `keyCards`/`avoid` filtering, `mana_base_skeleton` color/drawback/name checks.
- **Verification:**
  - `pnpm check` green.
  - Live MCP smoke check against Deck 51 (Henzie) covering all Top 5 fixes and Nov 18 retest items.

## 9. Open questions

1. Should `goldfish_step` default `strict` to `true` or `false`? *(Recommendation: `false` by default for backwards compatibility, or `true` when `manaPool` is explicitly tracked — confirm preference.)*
2. Fixed per-card `tags` vocabulary: start with `["ramp", "draw", "removal", "wipe", "protection", "wincon", "recursion", "combo", "land"]` plus arbitrary custom tags?
