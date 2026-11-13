# Design: Two-Card Combos in the Bracket Estimate

- **Phase:** Deck building — Phase 2 (backlog task #79)
- **Status:** **Approved** (per user instruction to continue roadmap)
- **Related ADRs:** 0006 (CQRS-lite reads), 0007 (External data behind an ACL), 0025 (Commander Spellbook combo data)
- **Lesson:** no

## 1. Purpose & scope

Bring Commander Spellbook's two-card combo catalog into `estimateBracket` so the deck builder, shared deck view, and `get_deck` MCP tool detect two-card combos (e.g. _Thassa's Oracle + Demonic Consultation_ → Bracket 4, late-game two-card combos → Bracket 3) and include them in `bracketWarning` and `fitsTarget`.

**Out of scope:**

- Three-or-more-card combos or template-only (`requires`) combos without concrete card `oracleId`s.
- Calling Commander Spellbook from Next.js request handlers (all sync happens in the worker via `catalog`).
- Non-Commander formats (`estimateBracket` already returns `null` outside Commander).

## 2. Ubiquitous language

| Term                 | Meaning in this codebase                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Two-card combo**   | A Commander-legal Commander Spellbook variant with exactly 2 concrete card components (`uses.length === 2` with `oracleId`s). |
| **Early-game combo** | A two-card combo tagged `R` (Ruthless) by Spellbook, or with total mana needed `<= 6` when untagged — forces **Bracket 4**.   |
| **Late-game combo**  | A two-card combo tagged `S`/`P`/`C` (or total mana needed `>= 7`) — allowed in **Bracket 3**, disallowed in Brackets 1–2.     |

## 3. Domain model

### `catalog/domain/spellbook.ts`

```ts
export type SpellbookTwoCardCombo = Readonly<{
  id: string;
  oracleIdA: string;
  oracleIdB: string;
  cardNameA: string;
  cardNameB: string;
  produces: readonly string[];
  bracketTag: string | null;
  manaValue: number | null;
  forcesBracket: 3 | 4;
}>;

/** Pure classifier: maps Spellbook bracketTag + mana value to Bracket 3 or 4. */
export function twoCardComboBracket(bracketTag: string | null, manaValue: number | null): 3 | 4;
```

### `decks/domain/brackets.ts`

- Add `"twoCardCombos"` to `BRACKET_RULE_NAMES`:
  `["gameChangers", "landDenial", "extraTurns", "twoCardCombos"]`
- Add `DeckCombo`:
  ```ts
  export type DeckCombo = Readonly<{
    id: string;
    cards: readonly [string, string];
    produces: readonly string[];
    forces: Bracket;
  }>;
  ```
- Extend `estimateBracket`:
  ```ts
  export function estimateBracket(
    format: Format,
    lines: readonly BracketLine[],
    options?: Readonly<{ combos?: readonly DeckCombo[] }>,
  ): BracketEstimate | null;
  ```
  - When `options?.combos` is provided, each combo adds a `BracketFinding` with `rule: "twoCardCombos"`, `cards: combo.cards`, `count: 1`, `forces: combo.forces`, and `"combos"` is removed from `unchecked` (leaving `["intent"]`).
  - When `options?.combos` is omitted, behavior is unchanged and `unchecked` stays `["intent", "combos"]`.

## 4. Invariants

1. **No network in request handlers:** All Spellbook data is read from Postgres (`spellbook_two_card_combos`).
2. **Canonical pair ordering:** `oracleIdA <= oracleIdB` in `spellbook_two_card_combos` so pairs are deduplicated and indexed consistently.
3. **Browser-safe domain:** `brackets.ts` stays pure with no Node/DB imports; `DeckCombo[]` is passed in by callers that have DB access (server queries / builder props / `get_deck`), and omitted gracefully in pure browser-only contexts if not loaded.
4. **Backward-compatible `estimateBracket`:** Callers that omit `options.combos` see identical output and `unchecked: ["intent", "combos"]`.

## 5. Persistence (`catalog/infrastructure/schema.ts`)

Table `spellbook_two_card_combos`:

- `id text primary key` (Spellbook variant ID)
- `oracle_id_a uuid not null`
- `oracle_id_b uuid not null`
- `card_name_a text not null`
- `card_name_b text not null`
- `produces jsonb not null` (`string[]`)
- `bracket_tag text`
- `mana_value integer`
- `forces_bracket integer not null` (`3` or `4`, `CHECK (forces_bracket IN (3, 4))`)
- `synced_at timestamptz not null default now()`

Indexes on `(oracle_id_a)` and `(oracle_id_b)`.

## 6. Use cases & queries

- `catalog`: `SpellbookGateway.fetchTwoCardCombos()` → `syncSpellbookCombos` (worker job + admin/CLI trigger).
- `decks/queries/combos.ts`: `combosForDeck(db, oracleIds)` queries `spellbook_two_card_combos` where both `oracle_id_a` and `oracle_id_b` are in the deck's played `oracleIds`, returning `DeckCombo[]`.
- Wire `combosForDeck` into:
  - `deckBuilderData` / `BuilderDeck` (`src/app/decks/[id]/builder/actions.ts` & `deck-builder.tsx`)
  - `shared-view.tsx` / shared deck loader
  - `get_deck` MCP tool (`src/app/_llm-tools/tools/decks.ts`)
  - `labels.ts` (`findingText` / `findingWithCards` for `rule === "twoCardCombos"`)

## 7. Test plan

- `catalog/domain/spellbook.test.ts`: `twoCardComboBracket` classification (`R` → 4, `S`/`P`/`C` → 3, untagged `manaValue <= 6` → 4, `>= 7` → 3, `null` → 3).
- `catalog/infrastructure/spellbook-gateway.test.ts`: ACL mapper filtering out 3+ card combos, non-Commander-legal combos, and missing `oracleId`s, plus canonical `oracleIdA <= oracleIdB` ordering.
- `decks/domain/brackets.test.ts`: `estimateBracket` with `combos` (empty array removes `"combos"` from `unchecked`, Bracket 3 vs Bracket 4 combo findings, `bracketWarning` includes combo findings).
- `src/app/decks/labels.test.ts`: `findingText` / `findingWithCards` for `twoCardCombos`.
- `pnpm check` passes all unit + integration tests.
