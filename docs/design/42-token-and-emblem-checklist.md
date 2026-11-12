# Design: Token and emblem checklist per deck

- **Phase:** 42 (tududi task `#50`, project "Build decks from owned cards")
- **Status:** **Approved** (2026-11-11)
- **Related:** design doc 25 (token proxies), design doc 28 (LLM tool API), design doc 32 (maybeboard & cuts)
- **Lesson:** no (pure classification/summary helpers on top of existing `TokenLine`, surfaced in deck builder, shared deck view, and MCP tools)

## 1. Purpose & scope

The catalog already syncs tokens, emblems (`Elspeth, Knight-Errant Emblem`), and helper cards (`The Monarch`, `The Initiative`) into `token_printings` and `printing_tokens`, and `deckTokenLines` (`src/modules/decks/queries/tokens.ts`) already computes a deck's tokens in deck order with art choices and `boards` attached. Until now, however, that data has only been visible on `/decks/[id]/print` when configuring proxy PDFs.

This phase surfaces a **token, emblem, and helper checklist** directly inside:

1. **The web deck builder** (`/decks/[id]` → new `Tokens` panel alongside `Mana base`, `Snapshots`, etc.) — updates live as cards are added/removed or moved to/from the maybeboard, distinguishes main/commander vs. sideboard-only tokens, shows rules text for emblems/helpers and the cards that create each item, and links to `/decks/[id]/print` for proxy art selection and printing.
2. **The shared deck view** (`SharedDeckView` on `/decks/[id]`) — displays a read-only `Tokens` section for viewers when the deck produces at least one token, emblem, or helper card.
3. **The MCP server** (`get_deck` and a new read-only `deck_tokens` tool) — summarizes counts in `get_deck` and provides the full filterable checklist (kind, board scope, descriptions, rules text, makers, and print status) via `deck_tokens`.

**Out of scope:** duplicating the 254-line `ArtPicker` or proxy-PDF inclusion checkboxes inside the builder (`chooseTokenAction` / `/decks/[id]/print` already own proxy print configuration), estimating how many copies of a token a game requires (always deck-card checklist, not combinatorics), and creating manual custom tokens not in Scryfall's `all_parts`.

## 2. Ubiquitous language

| Term           | Meaning in this codebase                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Token kind     | `"token" \| "emblem" \| "helper"`, derived from a `TokenArt`'s front `typeLine`.                          |
| Emblem         | A token printing whose front `typeLine` identifies an emblem (e.g., `"Emblem — Elspeth"`).                |
| Helper card    | Non-token, non-emblem game marker in `token_printings` (e.g., `"The Monarch"`, `"The Initiative"`).       |
| Sideboard-only | A `TokenLine` whose `boards` contain no played board (`!line.boards.some(isPlayed)`).                     |
| Deck checklist | The deck's `TokenLine[]` (which already excludes maybeboard cards via `isCounted`) summarized with kinds. |

## 3. Domain model & pure functions

Extending `src/modules/decks/domain/token-proxies.ts` (all pure, exported through `src/modules/decks/client.ts` and `src/modules/decks/index.ts`):

```ts
export const TOKEN_KINDS = ["token", "emblem", "helper"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export type TokenChecklistSummary = Readonly<{
  total: number;
  tokens: number;
  emblems: number;
  helpers: number;
  mainboard: number;
  sideboardOnly: number;
}>;

export type TokenChecklistItem = Readonly<{
  oracleId: string;
  name: string;
  kind: TokenKind;
  description: string;
  /** Rules text from the token's faces (especially useful for emblems and helper cards). */
  text: string;
  colors: readonly string[];
  hasBack: boolean;
  madeBy: readonly string[];
  boards: readonly Board[];
  sideboardOnly: boolean;
  includedInProxies: boolean;
  art: TokenArt;
}>;

/** Classifies a token printing by its front type line (case-insensitive word match). */
export function tokenKind(art: TokenArt): TokenKind;

/** Combined rules text across faces, or "" when vanilla. */
export function tokenRulesText(art: TokenArt): string;

/** Maps a TokenLine to a checklist item with kind, rules text, and sideboard-only flag. */
export function toTokenChecklistItem(line: TokenLine): TokenChecklistItem;

/** Summarizes counts across a list of TokenLine values. */
export function summarizeTokenChecklist(lines: readonly TokenLine[]): TokenChecklistSummary;

/** Filters checklist items by optional kind ("all" | TokenKind) and board scope ("all" | "played"). */
export function filterTokenChecklist(
  items: readonly TokenChecklistItem[],
  filter: { kind?: TokenKind | "all"; board?: "all" | "played" },
): TokenChecklistItem[];
```

Classification rules in `tokenKind`:

1. Take `art.faces[0]?.typeLine ?? ""`.
2. If `/\bemblem\b/i.test(typeLine)` → `"emblem"`.
3. Else if `/\btoken\b/i.test(typeLine)` → `"token"`.
4. Else → `"helper"`.

## 4. Invariants

1. **Maybeboard excluded:** inherited from `deckTokens` (`isCounted(maker.board)`), so moving a token-maker card to `maybe` removes its tokens from the checklist unless another counted card also creates them.
2. **Sideboard-only detection:** `sideboardOnly === true` iff `line.boards.every((board) => !isPlayed(board))`. Filtering by `board: "played"` keeps items made by at least one `main` or `commander` card (even if a sideboard card also makes it).
3. **Summary consistency:** `summary.total === summary.tokens + summary.emblems + summary.helpers` and `summary.total === summary.mainboard + summary.sideboardOnly` for all inputs.
4. **Authz on read paths:**
   - Web builder `tokensAction(deckId)` verifies `requireActor()` and ownership via `deckView(db, actor.userId, deckId)` (returns `null` if not owned).
   - `SharedDeckView` receives `tokens` computed server-side inside `page.tsx` only after `deckForViewer` has authorized the viewer.
   - MCP `get_deck` and `deck_tokens` use `deckView(db, actor.userId, input.deckId)`.

## 5. Use cases & API surface

No new write use cases or database tables are needed; this feature exposes existing persisted token links and choices through read models, UI, and MCP tools.

### 5.1 Read models & server actions

- **Builder Server Action (`src/app/decks/[id]/builder/actions.ts`):**
  - `tokensAction(deckId: number): Promise<TokenLine[] | null>`
  - Validates `deckId` with Zod, loads `deckView(db, actor.userId, deckId)`, and calls `deckTokenLines(db, view.deck.id, makers)` mapping `view.lines` to `TokenMaker[]`.
  - Refresh pattern matches `ManaBasePanel`: debounced re-fetch when `deckKey` changes while the `Tokens` panel is open.
- **Deck Page & Shared View (`src/app/decks/[id]/page.tsx`, `shared-view.tsx`):**
  - For non-owner shared views (`!viewed.isOwner`), `page.tsx` loads `tokens = await deckTokenLines(db, viewed.view.deck.id, makers)` and passes it to `SharedDeckView`, which displays a compact `"Tokens & emblems (N)"` button/panel (matching `"Test hand"`) when `tokens.length > 0` (or always available alongside `"Test hand"`).

### 5.2 UI components (`src/app/decks/[id]/builder/tokens-panel.tsx`)

- `TokensPanel` displays:
  - Header with title `"Tokens & emblems"`, count summary (e.g., `"4 tokens · 1 emblem"`), and close button.
  - Filter controls when the deck has mixed kinds or sideboard-only items: kind pills (`All`, `Tokens`, `Emblems`, `Helpers` — showing only kinds present or All) and a `"Hide sideboard-only"` toggle when `sideboardOnly > 0`.
  - Checklist items (`<ul>`), each showing:
    - Small front image preview (`/api/images/${item.art.id}/small/front`, matching `token-section.tsx` dimensions `146/204` aspect)
    - Name + kind badge (`Emblem` / `Helper` / `Token`) + `description` (`Token Creature — Goblin · 1/1`)
    - Rules text when present (especially valuable for emblems and `The Monarch` / `The Initiative`)
    - `"Made by: ..."` card list
    - `"Sideboard only"` badge if `item.sideboardOnly`, and `"Excluded from proxy PDF"` note if `!item.includedInProxies`
  - Footer link (when `deckId` + owner editable view): `"Choose art & print token proxies"` linking to `/decks/${deckId}/print`.
- `deck-builder.tsx`:
  - Add `"tokens"` to the `Tool` union (`"suggestions" | "cuts" | "mana" | "draft" | "hand" | "snapshots" | "tokens" | null`) and add a `"Tokens"` button to the tool bar.

### 5.3 MCP tools (`src/app/_llm-tools/tools/decks.ts`)

1. **`get_deck`** (`scope: "read"`):
   - Fetches `deckTokenLines` for the deck and attaches a compact `tokens` field:
     ```ts
     tokens: {
       summary: TokenChecklistSummary, // { total, tokens, emblems, helpers, mainboard, sideboardOnly }
       items: items.map((item) => ({
         name: item.name,
         kind: item.kind,
         description: item.description,
         madeBy: item.madeBy,
         sideboardOnly: item.sideboardOnly,
       })),
     }
     ```
2. **`deck_tokens`** (`scope: "read"`, `readOnly: true`, registered in `src/app/_llm-tools/registry.ts`):
   - Input:
     - `deckId`: positive integer
     - `board`: `z.enum(["all", "played"]).default("all")`
     - `kind`: `z.enum(["all", "token", "emblem", "helper"]).default("all")`
   - Output:
     - `deckId`, `deckName`
     - `summary`: `TokenChecklistSummary` (for the full deck before filters)
     - `showing`: number of items after filters
     - `items`: detailed checklist items with `oracleId`, `name`, `kind`, `description`, `text`, `colors`, `hasBack`, `madeBy`, `boards`, `sideboardOnly`, `includedInProxies`, and `art: { id, setCode, setName, collectorNumber }`.

## 6. Test plan

- **Domain unit tests (`src/modules/decks/domain/token-proxies.test.ts`):**
  - `tokenKind` classifies tokens, double-faced tokens, emblems (`"Emblem — Elspeth"`), and helper cards (`"Card"` / `"The Monarch"`).
  - `toTokenChecklistItem` computes `sideboardOnly`, `text`, `description`, and `includedInProxies`.
  - `summarizeTokenChecklist` satisfies count invariants across mixed boards and kinds.
  - `filterTokenChecklist` filters by `kind` and `board: "played"` vs `"all"`.
- **Integration tests (`tests/integration/decks.int.test.ts`):**
  - Deck containing a token maker, an emblem planeswalker (or emblem link), and a sideboard-only token maker produces accurate `deckTokenLines` + checklist summary/filtering, and moving the maker to `maybe` removes its token from the checklist.
- **LLM tool & scope tests (`src/app/_llm-tools/registry.test.ts`, `src/app/_llm-tools/llm-tools.int.test.ts`):**
  - `deck_tokens` is registered with `scope: "read"`.
  - End-to-end `get_deck` returns `tokens.summary` + compact `tokens.items`, and `deck_tokens` returns detailed items and respects `board` / `kind` filters.

## 7. Open questions

None — reuses existing `token_printings`, `printing_tokens`, `deck_token_choices`, and `deckTokenLines` without schema changes.
