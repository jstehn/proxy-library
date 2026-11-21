# Design: Proxy Library MCP Commander Awareness, Output Caps & Deck Primers

- **Phase:** 61
- **Status:** Done (lesson: [61](https://github.com/jstehn/proxy-library-lessons/blob/main/61-answers-a-model-can-read.md))
- **Superseded in part** (2026-11-20, P22): the goldfish rules (section 4 rules 1-3) were removed with the goldfish (P24); the rest is in llm-tools.md; see docs/modules/llm-tools.md
- **Superseded in part** (2026-11-21, P36): the response cap in section 4 rule 7 is 14,000 bytes (`MAX_TOOL_RESPONSE_BYTES`), not about 40 KB; owner: whatever is smaller and more effective; see docs/modules/llm-tools.md
- **Related ADRs:** 0007 (ACLs), 0016 (client-safe module API), 0023 (design doc sizing)
- **Lesson:** yes (cost-reducer modeling, stateful turn-simulator invariants, response-size budgeting)

## 1. Purpose & scope

Make Proxy Library's MCP simulators, heuristics, and counts commander-aware, cap and paginate large tool responses, and add a structured **Deck Profile & Primer** (stored per deck, editable in the UI and via MCP tools) alongside per-card metadata (`tags`, `role`, `pinned`).

**Out of scope:**

- Changing non-MCP deck export formats (Moxfield/Archidekt text export stays as-is).
- Full multiplayer combat/stack rules engine in `goldfish_*` (goldfish remains a solo turn-by-turn line-of-play simulator).
- Automatic verdict/scoring labels (consistent with Phase 60, `check_interaction` is a rulings + shared-CR lookup, not a verdict).

## 2. Ubiquitous language

| Term             | Meaning in this codebase                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Deck Profile** | Structured per-deck metadata (`landTarget`, `roleTargets`, `keyCards`, `avoid`, `costReducers`, `winCons`, `combos`, `plan`, `mulligan`, `pilotNotes`) read by heuristics and MCP tools.               |
| **Primer**       | Free-form Markdown attached to a deck, supporting `[[Card Name]]` hover links and section-level patching via `set_primer`.                                                                             |
| **Cost Reducer** | A declarative discount rule in a deck profile (e.g., Henzie: `blitz` −1 generic per command-zone cast; Goreclaw: −2 generic for power ≥ 4).                                                            |
| **Goldfish v2**  | Stateful solo simulator with mana pool tracking, `keep` / `end_step` actions, `strict` mana enforcement, command-zone cast counting + commander tax, `alt: "blitz"`, and short card keys (`h1`, `b3`). |
| **Response Cap** | ~40 KB UTF-8 JSON ceiling enforced by MCP tool serialization, returning a `next` cursor instead of truncating mid-payload.                                                                             |

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
  tags: string[]; // fixed role tags + custom tags
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

## 5. Output size caps & `get_deck` reduction (Top Priority)

Several tools (`get_deck` at 98.6 KB, `find_combos` cutting off near 97 KB, `deck_sources` returning the whole list) exceed comfortable LLM context budgets.

1. **`get_deck` `fields` and `boards` filters:**
   - `boards?: ("commander" | "main" | "sideboard" | "maybe")[]` — filter which boards are returned.
   - `fields?: ("summary" | "entries" | "stats" | "bracket" | "tokens" | "odds" | "list" | "profile")[]` — select only the sections needed; omit `entries` / `text` when only stats or list are requested.
   - Include a 1-paragraph `profileSummary` at the top when a deck profile exists.
2. **Global ~40 KB response capper (`src/app/_llm-tools/`):**
   - Measure serialized JSON byte length (`Buffer.byteLength(json, "utf8")`) before returning from any MCP tool.
   - If a response exceeds `MAX_MCP_RESPONSE_BYTES` (40,000 bytes), paginate the primary array/map field and attach `{ next: <cursor>, truncatedByCap: true, totalCount }` rather than slicing raw strings or exceeding client limits.
   - `find_combos` / `find_combos_for_deck` additionally support explicit `limit`, `offset`, and `bracket` filters.
   - `deck_sources` returns only the newly added row on `add`.

### 5a. Revision (Nov 18): a compact `get_deck` by default (approved, built in 5d73ed6)

The `fields`/`boards` filters and the capper shipped (5051d9c), but the default response is still
built for a program rather than a reader. Measured on deck 51 (85 main entries + 34 maybe):

- Every line is an object with two UUIDs (`oracleId`, `printingId`), a `{cents, text}` price,
  `owned`/`free`/`otherDecks`, `manaValue` _and_ `manaCost`, and empty `tags: []`. That's roughly
  350–600 bytes per card before oracle text.
- The same cards appear up to four times: `lines`, `list`, `shortList`, `toComplete.cards` and
  `toComplete.maybeboard`.
- `tokens`, `openingHandOdds`, `formatRules`, `cardLegalIn`, `roleTargets`, `deckSources` are
  sent on every call though few deck-building turns need them.
- When the capper does paginate, it splits `lines` mid-board, so a reader gets half a deck plus
  every secondary section again on each page.

**What a deck-building LLM needs on the first read:** what the deck is for (profile summary,
commander, bracket), every card once, grouped the way the player grouped them, with cost, type,
role/tags and an "unowned" flag; the shape (lands, curve, roles, color pips vs sources); and what's
wrong (problems). It also needs oracle text: judging synergy, cuts and replacements from names
alone means guessing. Ids, prices and other-deck usage are needed only for specific tasks
(buying, editing by id, sharing cards).

**Oracle text is cheap; the structure around it was not.** Measured on deck 51's 86 commander +
main cards in the local catalog: 12.2 KB of oracle text in total (non-land average 160 chars,
longest 520; the 23 non-basic lands add only 1.8 KB). Replacing the card's own name with `~` and
dropping parenthesized reminder text brings it to 10.8 KB. So text stays **on by default** for the
commander and main boards. Sending it to get_cards instead would cost an extra round trip on every
review and repeat each card's name, cost and type.

**New default (`view: "compact"`, target ≤ 25 KB for a 100-card deck, about 10 KB of it lines and
stats and 11 KB of text):**

```jsonc
{
  "deck": { "id": 51, "name": "…", "format": "commander", "commander": ["Henzie \"Toolbox\" Torre"],
            "cards": 100, "lands": 35, "averageManaValue": 3.8,
            "bracket": { "target": 3, "estimate": "1–2", "gameChangers": 0 } },
  "profileSummary": "…",            // when a profile exists
  "fingerprint": "…",
  "cards": {                         // grouped by heading (or type when grouping is by type)
    "Ramp": ["1 Birds of Paradise · {G} · Creature — Bird 0/1 · ramp — Flying. {T}: Add one mana of any color.",
             "1 Sol Ring · {1} · Artifact · ramp — {T}: Add {C}{C}."],
    "Win Conditions & Drain": ["1 Avacyn, Angel of Horror · {4}{W}{W}… · SHORT"]
  },
  "maybe": ["Jund Panorama", "Mortuary", "…"],     // names only
  "stats": { "curve": […], "types": {…}, "pips": {…}, "sources": {…}, "roles": {…} },
  "problems": ["…"],
  "short": { "copies": 4, "cost": "$47.38", "cards": ["Avacyn, Angel of Horror ($12.01)"] },
  "more": "include: text | prices | ids | owners | tokens | odds | sources | legality; cards: [names]"
}
```

Line strings: `qty name · cost · type line [P/T] · tags — oracle text`, then flags only when true
(`SHORT`, `GC`, `note: …`). No `[]`, no null fields. In the text, the card's own name becomes `~`
and reminder text is dropped; double-faced cards join faces with `//`. Basic lands have no text.

**Size safety:** if a deck still exceeds the cap (a 250-card deck, or an unusually wordy one), the
response pages by _whole headings_ with `cursor`, and the header, stats and problems come only on
page one. It never splits a card or repeats the other sections.

**Opt-ins:**

- `text: false` drops oracle text (a quick list-shaped read, about 10 KB).
- `boards: ["maybe"]` (or `includeMaybe: true`) returns maybeboard lines in the same format, text
  included; by default the maybeboard is names only.
- `cards: ["Avacyn, Angel of Horror", …]` returns full detail (full text with reminder text,
  ids, price, owned, other decks, note) for just those cards.
- `include: ["prices" | "ids" | "owners" | "tokens" | "odds" | "sources" | "legality"]` adds the
  matching section. `view: "full"` keeps today's object lines for scripts and tests.
- `boards` keeps working; `fields` is replaced by `include` (old values map onto it).

**Out:** `list` is dropped from the default (the grouped `cards` are the readable list; `include:
["list"]` returns the import/export text). `shortList` and `toComplete` merge into `short`.

## 6. Use cases & MCP tools

| Tool / Use case                    | Actor / authz | Input                                                    | Output / Behavior                                                                                     |
| ---------------------------------- | ------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `get_deck_profile`                 | Deck viewer   | `{ deckId }`                                             | Compact structured `DeckProfile` (a few KB) + fallback summary.                                       |
| `set_deck_profile`                 | Deck owner    | `{ deckId, patch }`                                      | Updates structured `DeckProfile` fields.                                                              |
| `set_primer`                       | Deck owner    | `{ deckId, section, content }`                           | Patches a single Markdown `## Section` (or full primer when `section` omitted).                       |
| `get_deck`                         | Deck viewer   | `{ deckId, fields?, boards?, includeText? }`             | Adds 1-paragraph profile summary at top; filters by `fields`/`boards`.                                |
| `goldfish_start` / `goldfish_step` | Deck viewer   | `keep`, `end_step`, `tap`, `cast { key, alt?, strict? }` | Mana pool, commander tax, blitz, short keys (`h1`, `b3`).                                             |
| `simulate_opening_hands`           | Deck viewer   | `{ deckId, mustCastBy?: { card, turn } }`                | Returns % of hands able to cast `card` (default: commander) by `turn`, counting dorks/rocks/reducers. |
| `find_combos_for_deck`             | Deck viewer   | `{ deckId, bracket?, limit?, offset? }`                  | `complete` / `needsMaybe` / `oneAway`, bracket legend (E/P/O/S/R/C), pagination.                      |
| `get_cards`                        | Public        | `{ names[] }`                                            | Resolves back-face names (e.g. `"Temple of Cultivation"` → Ojer Kaslem).                              |
| `get_rulings`                      | Public        | `{ cardName }`                                           | Adds `relatedRules` matched from oracle-text patterns (`513`, `118.9`, `400.7`, etc.).                |
| `check_interaction`                | Public        | `{ cards[] }`                                            | Returns each card's rulings + shared CR sections across their texts (lookup only).                    |

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

## 10. Resolved decisions

1. `goldfish_step` defaults `strict` to `true` (refuse casts you cannot pay for unless `strict: false` is passed).
2. Fixed per-card `tags` vocabulary: `["ramp", "draw", "removal", "wipe", "protection", "wincon", "recursion", "combo", "land"]` plus arbitrary custom tags.
