# Design: LLM tools (MCP + OpenAPI)

- **Phase:** 28
- **Status:** **Approved** (2026-11-07) with every recommendation in section 13, plus one
  addition: expand the card search language as far as the stored data reasonably allows
  (section 3.6).
- **Related:** ADR 0022 (this phase), ADR 0017 (shared card search), ADR 0019 (stored card
  features), design doc 20 (suggestions), design doc 23 (fingerprints for safe list edits),
  design doc 26 (wishlist), design doc 02 (accounts)

## 1. Purpose & scope

Your request: let an LLM connect to Proxy Library and **help build decks and make
recommendations**, using your real collection, decks, wishlist and wallet. It must work with
**almost any LLM**, not one vendor's app.

The app already knows everything a deck-building assistant needs, but none of it is reachable by
a program: reads are server components, writes are server actions behind a sign-in cookie. This
phase adds a **tool API**:

- **One tool registry**: each tool is a name, instructions for the model, a Zod input and output
  schema, a permission scope and a handler that calls existing queries and use cases.
- **Two endpoints over it**, both open standards:
  - `POST /api/mcp`: a **Model Context Protocol** server (Streamable HTTP), for MCP clients
    (Claude apps, ChatGPT desktop, Gemini CLI, Cursor, VS Code, LM Studio, Open WebUI, Goose, …).
  - `POST /api/tools/<name>` with `GET /api/tools/openapi.json`: plain JSON over HTTP described
    by **OpenAPI 3.1**, for anything that does function calling without MCP (custom GPT actions,
    Open WebUI tool servers, a short script around a local Ollama model).
- **Personal access tokens**: you make one on your Account page, paste it into the client, and the
  client sends it as `Authorization: Bearer pl_…`. The token acts as you, limited to its scopes.
- **A synergy search built for LLMs** (`search_for_deck`): the model works out what a commander
  rewards, writes one search per synergy, and the app runs them all inside the deck's rules
  (color identity, legality, not already in the deck) over your cards and the store, merging the
  results. Its instructions, a syntax guide and a tested **cookbook** of query patterns travel
  with the tool.

The example that prompted it: for **Jolene, the Plunder Queen** you asked an LLM for R/G cards
that make Treasures, reward artifacts, or trigger when an artifact is sacrificed, and it searched
Scryfall. With this phase it searches _your_ cards and _this_ store instead, and can add the
owned picks to the deck and wishlist the rest.

**Out of scope:**

- **Spending money or giving things up**: buying singles, sealed or wishes, selling, opening
  packs, trades, drafts, deleting decks, Start over, admin. Those stay in the web UI (decision 2).
  A `spend` scope with a price cap is a possible later phase.
- **OAuth 2.1** (sign-in pages, dynamic client registration). Web connectors that accept only
  OAuth (claude.ai, ChatGPT web) need it; it's a later phase (decision 1).
- **An LLM inside the app** (a chat box on the deck page). The app serves tools; the model and
  chat live in your client of choice. No API keys for model providers are stored.
- **Scryfall-wide search.** Searches cover this catalog only (expansion, core and Commander sets
  by default, design doc 04 rule 13), because only those cards can go in a deck or be bought.

## 2. Ubiquitous language

| Term                | Meaning in this codebase                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM tool            | One operation a model may call: name, instructions, input/output schemas, scope, handler. Defined once in the registry.                         |
| Tool registry       | The list of every LLM tool (`src/server/llm-tools/registry.ts`). Both endpoints are built from it.                                              |
| MCP                 | Model Context Protocol: JSON-RPC messages (`tools/list`, `tools/call`, …) over HTTP. The open standard most LLM clients speak.                  |
| OpenAPI             | A JSON description of an HTTP API. Function-calling clients turn each operation into a tool.                                                    |
| Access token        | A secret string `pl_…` that stands for one player. Only its SHA-256 hash is stored. Shown once.                                                 |
| Scope               | What a token may do: `read`, `decks:write`, `wishlist:write`.                                                                                   |
| Synergy query       | One search the model writes for one idea (`Treasure makers: o:/create[^.]*treasure/`), labelled with that idea.                                 |
| Enabler / payoff    | The two halves of a synergy: cards that make the thing happen (create Treasures) and cards that reward it (whenever an artifact is sacrificed). |
| Deck rules (search) | What every synergy query is ANDed with: commander color identity, format legality, not already in the deck.                                     |
| Cookbook            | Tested synergy query patterns for common mechanics, served by `get_search_guide`.                                                               |
| Tool instructions   | The tool's description text: when to use it, how to fill it in, how to read the result. Models read it every time they consider the tool.       |

## 3. Domain model

### 3.1 Access tokens (accounts module)

```ts
/** What a token may do. `read` is always included. */
const SCOPES = ["read", "decks:write", "wishlist:write"] as const;
type Scope = (typeof SCOPES)[number];

type AccessToken = Readonly<{
  id: AccessTokenId; // branded number
  userId: UserId;
  name: string; // "LM Studio on the desktop", 1–60 characters
  prefix: string; // first 8 characters after "pl_", to tell tokens apart in the list
  scopes: readonly Scope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}>;

/** The secret itself exists only in the response that creates it. */
type NewAccessToken = Readonly<{ token: AccessToken; secret: string }>;

/** Who a valid token stands for. */
type TokenActor = Readonly<{ actor: Actor; scopes: readonly Scope[]; tokenId: AccessTokenId }>;
```

Pure functions in `accounts/domain/access-token.ts`:

```ts
function tokenSecret(randomBytes: Uint8Array): string; // "pl_" + base64url(32 bytes)
function looksLikeToken(text: string): boolean; // shape check before any database work
function tokenHash(secret: string): string; // hex SHA-256
function withRead(scopes: readonly Scope[]): Scope[]; // adds "read", removes duplicates, fixed order
function allows(scopes: readonly Scope[], needed: Scope): boolean;
function shouldTouch(lastUsedAt: Date | null, now: Date): boolean; // at most once a minute
```

### 3.2 LLM tools (app layer, `src/server/llm-tools/`)

```ts
type ToolContext = Readonly<{
  actor: Actor;
  scopes: readonly Scope[];
  container: Container; // the app's services and db, as server actions use them
}>;

/** What a tool's handler returns: a value, or an expected failure the model can act on. */
type ToolOutcome<Output> =
  Readonly<{ ok: true; value: Output }> | Readonly<{ ok: false; error: ToolError }>;

type ToolError = Readonly<{
  kind: string; // the module's error kind: "DeckNotFound", "DeckChanged", "ListProblems", …
  message: string; // a sentence for the model: "Deck 42 isn't yours or doesn't exist. Call list_decks."
}>;

type LlmTool<Input, Output> = Readonly<{
  name: string; // verb_noun: "search_for_deck"
  title: string; // "Search cards for a deck"
  description: string; // the tool instructions (section 3.4)
  scope: Scope;
  input: z.ZodType<Input>; // a flat z.object; compatibility rules in invariant 9
  output: z.ZodType<Output>;
  run(context: ToolContext, input: Input): Promise<ToolOutcome<Output>>;
}>;
```

The registry is an array of these. The tool files are thin controllers: parse (done by the
adapter with the tool's schema), call the query or use case, map `Result` errors to `ToolError`
sentences, shape the output with `format.ts`.

### 3.3 `search_for_deck`

```ts
type SynergyQuery = Readonly<{
  synergy: string; // the idea, 1–60 characters: "Treasure makers"
  search: string; // card search text, 1–300 characters
}>;

type SearchForDeckInput = Readonly<{
  deckId: number;
  queries: readonly SynergyQuery[]; // 1–8
  where: "owned" | "store" | "both"; // default "both"
  goal?: string; // what the deck is going for, echoed back; helps the model stay on track
  maxPerQuery: number; // default 20, at most 50
  maxPrice?: number; // cents; store side only
  includeText: boolean; // default true
}>;

type QueryReport = Readonly<{
  synergy: string;
  search: string;
  found: number; // distinct cards, before the cap
  shown: number;
  capped: boolean;
  notes: readonly string[]; // the parser's: `Unknown keyword "otag:" (ignored)`
  hint: string | null; // "Found nothing: …" / "More than 50: …" (rule 14)
}>;

type FoundCard = Readonly<{
  name: string;
  oracleId: string;
  printingId: string; // the owned copy to use, or the store's cheapest, standard printing first
  manaCost: string;
  typeLine: string;
  text?: string; // oracle text, all faces, when includeText
  roleTags: readonly Tag[];
  themes: readonly Theme[];
  owned: number; // copies you could put in this deck (virtual, plus real if the deck uses them)
  storePrice: MoneyView | null; // null when not for sale
  wished: boolean;
  synergies: readonly string[]; // every query it matched, in query order
}>;

type SearchForDeckOutput = Readonly<{
  deck: Readonly<{ id: number; name: string; format: Format; commanderColors: Color[] | null }>;
  goal: string | null;
  queries: readonly QueryReport[];
  cards: readonly FoundCard[]; // merged, ranked (rule 13), at most 200
}>;

type MoneyView = Readonly<{ cents: number; text: string }>; // { cents: 123, text: "$1.23" }
```

Pure functions (tested without a database, `src/server/llm-tools/search-for-deck.ts`):

```ts
/** Joins each query's hits into one list per card, with every synergy it matched. */
function mergeHits(hits: readonly QueryHits[]): FoundCard[];
/** More synergies first, then owned before store, then cheaper, then name. */
function rankFound(cards: readonly FoundCard[]): FoundCard[];
/** What to tell the model about a query that found nothing or too much. */
function queryHint(report: Omit<QueryReport, "hint">, parsed: SearchNode): string | null;
```

### 3.4 Tool instructions

Every description follows one shape so a model can scan it, and so the contract test can check
the parts exist:

```
<One sentence: what it does.>
Use it when: <cases>. Don't use it for: <cases, and which tool instead>.
Inputs: <only what isn't obvious from the schema>.
Returns: <what comes back and how to read it>.
Rules: <house rules that matter here>.
Example: <one realistic call>.
```

`search_for_deck`'s description, in full (draft; the cookbook holds more examples):

> Runs several card searches for one deck at once, one per synergy you name, and merges the
> results. Every search is automatically limited to the deck's commander colors and format and
> leaves out cards already in the deck, so don't add color or legality terms yourself.
>
> **Use it when** building or upgrading a deck around a commander or plan: finding enablers and
> payoffs, "what do I own that fits", replacing cards in a role. **Don't use it for** one known
> card (`get_card`) or general staples (`suggest_for_deck`).
>
> **How to write the queries.** First read the commander's text with `get_deck`, and call
> `analyze_cards` to see what the rest of the deck keeps doing (counters, tokens, triggers). List 3–8
> synergies, splitting each mechanic into enablers (cards that create Treasures, sacrifice
> artifacts, make tokens) and payoffs (cards that say "whenever …" or "for each …" about it).
> Write one query per synergy in Scryfall-style syntax. Use `o:/regex/` for rules text, and
> `[^.]*` between words to stay inside one sentence: `o:/whenever [^.]*artifact[^.]* sacrificed/`.
> Narrow with `t:` (type), `mv<=3`, or `tag:ramp|draw|removal|wipe|counter|tutor|protection` and
> `theme:tokens|sacrifice|artifacts|counters|graveyard|…` (`otag:` and `function:` work for the
> values that match a tag). `~` in `o:` means the card's own name. Not supported: `art:`, flavor
> text, Scryfall's other `otag:` values; call `get_search_guide` for the full syntax and tested
> patterns.
>
> **Reading the result.** Cards that matched several synergies are the strongest leads. Read
> each card's text before recommending it; the searches find candidates, you judge fit. If a
> query found 0, loosen it; if it was capped, narrow it, and run again. Prefer owned cards;
> `storePrice` is what it would cost.
>
> **Example** (Jolene, the Plunder Queen): queries `Treasure makers: o:/create[^.]*treasure/`,
> `Artifact sacrifice payoffs: o:/whenever [^.]*artifacts? [^.]*(is|are) (put into|sacrificed)/`,
> `Sacrifice outlets: o:/sacrifice (a|an|another) [^.]*artifact/`, `Cheap ramp: tag:ramp mv<=3`.

### 3.5 The cookbook

Data, not prose, so it can be tested (`src/server/llm-tools/cookbook.ts`):

```ts
type CookbookEntry = Readonly<{
  mechanic: string; // "Treasure"
  whenToUse: string; // "Commanders that make, count or sacrifice Treasures."
  enablers: readonly SynergyQuery[];
  payoffs: readonly SynergyQuery[];
}>;
```

First entries: Treasure, artifacts matter, sacrifice outlets, aristocrats (dies triggers),
tokens, +1/+1 counters, landfall, enters-the-battlefield and blink, spells matter, graveyard and
recursion, lifegain, Equipment and Auras, a creature type (written as a template:
`t:<type>` and `o:/<type>s? you control/`), extra combats, card-draw payoffs, and a mana base
entry (the land cycles of section 3.6 within the deck's colors). Each query is checked by a test
(rule 15).

### 3.6 Search language additions

You asked for the search to go as far as it reasonably can, since the tools lean on it. It
already covers most of Scryfall's syntax (`o:` `t:` `c:` `id:` `mv` `m:` `pow` `tou` `loy` `def`
`r:` `s:` `f:` `is:` `kw:` `a:` `cn:` `produces:` `usd` `year` `date` `border:` `frame:` `own`
`real`, regular expressions, `or`, `-`, parentheses). The additions below use only data the
catalog already stores, so no sync changes. All are in the shared parser (ADR 0017), so the web
search boxes get them too, and `/search-help` documents them.

| Write                                                                                                                                                                                             | Finds                                                                                  | Reads                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| `tag:ramp` (`role:`)                                                                                                                                                                              | cards with that role: ramp, draw, removal, wipe, counter, tutor, protection            | `printings.role_tags`                     |
| `theme:tokens`                                                                                                                                                                                    | cards that play into a theme: counters, tokens, sacrifice, graveyard, artifacts, …     | `printings.theme_tags`                    |
| `otag:` `function:`                                                                                                                                                                               | aliases of `tag:`/`theme:` for the Scryfall tags that mean the same (table below)      | as above; other values noted, not guessed |
| `banned:commander`, `restricted:vintage`                                                                                                                                                          | banned / restricted in that format                                                     | `printings.legalities`                    |
| `pow>tou`, `tou>pow`, `pow>=mv`, …                                                                                                                                                                | compares two numbers on the same card: `pow`, `tou`, `loy`, `def`, `mv`                | faces, `mana_value`                       |
| `mv:even`, `mv:odd`                                                                                                                                                                               | even or odd mana value                                                                 | `mana_value`                              |
| `o:~` (in any `o:` text or pattern)                                                                                                                                                               | `~` stands for the card's own name: `o:"when ~ dies"`, `o:/sacrifice ~:/`              | faces, `name`                             |
| `fo:` (`fulloracle:`)                                                                                                                                                                             | rules text **with** reminder text; `o:` now leaves reminder text out, as Scryfall does | faces                                     |
| `is:modal`                                                                                                                                                                                        | "Choose one —" (or two, any number…) spells and abilities                              | faces                                     |
| `is:party`, `is:outlaw`                                                                                                                                                                           | Cleric/Rogue/Warrior/Wizard; Assassin/Mercenary/Pirate/Rogue/Warlock                   | `type_line`                               |
| `is:hybrid`, `is:phyrexian`                                                                                                                                                                       | hybrid mana (`{R/G}`, `{2/W}`), Phyrexian mana (`{G/P}`) in the cost                   | `mana_cost`                               |
| `is:frenchvanilla`                                                                                                                                                                                | creatures whose only rules text is keywords                                            | faces, `keywords`                         |
| `is:dual` `is:shockland` `is:fetchland` `is:checkland` `is:fastland` `is:slowland` `is:painland` `is:bounceland` `is:scryland` `is:gainland` `is:triome` `is:cycleland` `is:manland` `is:pathway` | the common land cycles, recognized from type line and rules text (rule 17)             | `type_line`, faces, `layout`              |
| `is:fetchable`                                                                                                                                                                                    | lands with a basic land type (a fetch land or "search for a Forest card" finds them)   | `type_line`                               |
| `is:basic`                                                                                                                                                                                        | basic lands                                                                            | `type_line`                               |

`otag:` / `function:` aliases: `ramp`, `mana-rock`, `mana-dork`, `land-ramp` → `tag:ramp`;
`draw`, `card-draw`, `card-advantage` → `tag:draw`; `removal` and any `removal-…` → `tag:removal`;
`board-wipe`, `sweeper`, `wrath` → `tag:wipe`; `counterspell` → `tag:counter`; `tutor` →
`tag:tutor`; `protection`, `hexproof-granter` → `tag:protection`; `sacrifice-outlet` →
`theme:sacrifice`; `token-maker`, `token-generator` → `theme:tokens`; `recursion`, `reanimation`,
`mill` → `theme:graveyard`; `lifegain` → `theme:lifegain`. Any other value is noted (`otag:x
isn't one of this app's tags; use o:/…/ or tag:`) so the model rewrites it instead of getting a
silent zero.

Left out, because the catalog doesn't store the data: flavor text (`ft:`), watermarks (`wm:`),
art tags (`art:`), `is:reserved`, `is:gamechanger`, other prices (`eur`, `tix`), EDHREC rank,
`devotion:` (rarely useful in deck building; could be added later from `mana_cost`).

The tools also get **sorting** as an input (`name`, `mv`, `price`, `power`, `rarity`), not as
search words, because sorting a merged result is the tool's job.

### 3.7 `analyze_cards`: what a deck (or any set of cards) keeps doing

Added at review for the Shroofus example: a Shroofus deck is full of spore counters and
Saprolings, which points to proliferate and token payoffs, but nothing about Shroofus itself says
so. Suggestions built from the commander alone miss what the **other 99 cards** have in common.
This tool counts the recurring mechanics across a group of cards and hands the model the
evidence; the model decides what synergy that suggests and writes `search_for_deck` queries for
it.

```ts
type AnalyzeCardsInput = Readonly<{
  deckId?: number; // the deck's cards (main and commander boards)
  search?: string; // or: your cards matching a search ("everything green I own")
  minimumCards: number; // a signal must appear on at least this many cards, default 3
}>;

type Signal = Readonly<{
  kind: SignalKind;
  name: string; // "spore counter", "Saproling token", "Fungus", "dies trigger"
  cards: number; // how many cards show it
  examples: readonly string[]; // up to 5 card names
  followUp: string; // a search that finds more of it: `o:/spore counters?/`
}>;

type SignalKind =
  | "counter" // a kind of counter named in rules text: spore, +1/+1, -1/-1, charge, oil, lore…
  | "token" // a token the cards create: Saproling, Treasure, Food, Clue, 1/1 Soldier…
  | "creatureType" // a creature type on the type lines (tribal)
  | "keyword" // a keyword ability (from the stored keywords)
  | "trigger" // a trigger family: dies, enters, attacks, leaves, cast, draw, landfall, sacrifice, lifegain, discard, mill
  | "cost" // something the cards pay with: sacrifice a creature/artifact, remove counters, discard, pay life, tap untapped creatures
  | "zone" // the graveyard, exile, the library top, "cast from"
  | "cardType" // more artifacts / enchantments / instants and sorceries than usual
  | "role" // the stored role tags
  | "theme" // the stored themes
  | "phrase"; // a recurring phrase none of the above catch (below)

type AnalyzeCardsOutput = Readonly<{
  cardCount: number;
  signals: readonly Signal[]; // most cards first, at most 40
}>;
```

- **Named signals** come from small regular-expression rules in one pure table
  (`src/shared/card-search/signals.ts`, next to tags and themes, so the deck builder can show
  them later): `(\S+) counters?` for counters (spore, +1/+1, oil…), `create[^.]*? (\w+)
(artifact |creature |enchantment )*tokens?` for tokens, and so on. Reminder text is removed
  first.
- **Recurring phrases** catch what no rule names: 2–4 word sequences (after removing the card's
  own name, numbers and common words) that appear on at least `minimumCards` cards, minus those
  already explained by a named signal. This is how a mechanic the app has never heard of still
  shows up ("for each fungus", "time counter", "the ring tempts you").
- Each signal carries a **follow-up search** in the search language, so the model can go straight
  to `search_for_deck`; the analysis never decides the synergy itself.
- The tool's description says what to do with it: "Look for signals that appear on many cards,
  then ask what rewards them: counters → proliferate and counter doublers; tokens of one kind →
  payoffs for that token; a trigger family → doublers and enablers; then call `search_for_deck`."
- Also runs on a search instead of a deck, so the model can ask "what does my green collection
  keep doing?" before building.

## 4. Invariants

1. **A token stands for exactly one active player.** A revoked token, a token of a disabled
   player, or a player who must change their password gets 401, the same answer as a wrong token.
2. **Only the hash of a token is stored**, and the secret is returned exactly once, in
   `createToken`'s result. Lookups compare hashes; nothing logs the secret.
3. **Every tool call checks the tool's scope** before running. A token without it gets 403 with
   the scope's name; nothing runs.
4. **Tools add no business rules.** Every read goes through an existing query and every write
   through an existing use case with the token's `Actor`, so ownership, legality, limits and
   validation are the same as in the web UI.
5. **No tool moves money, cards or sealed items**, deletes a deck, or touches another player's
   data. (The registry test lists the allowed write tools; adding one fails it.)
6. **Both endpoints expose the same tools** with the same input schemas and descriptions (the
   contract test compares `tools/list` with `openapi.json`).
7. **Every list is bounded**: paged (default 25, at most 100) or capped (`search_for_deck`: 8
   queries × 50 cards, 200 merged). No tool returns an unbounded list.
8. **Expected failures are answers, not crashes**: a module `Result` error becomes a
   `ToolError` with a sentence saying what to do next (MCP `isError: true`; HTTP 422). Defects
   throw and are 500s.
9. **Schemas stay simple enough for small local models**: a flat object at the top, no
   `oneOf`/`anyOf`/`allOf`, enums for choices, a description on every field, defaults where
   sensible. (Checked on the generated JSON Schema.)
10. **Everything a model needs is in the tool descriptions and results.** MCP server
    instructions, resources and prompts repeat it for clients that use them, but no tool depends
    on a client reading them.
11. **Edits from a stale view are refused**: `replace_deck_list` needs the `fingerprint` from
    `get_deck` and returns `DeckChanged` if the deck moved on (design doc 23).
12. **`search_for_deck` respects the deck**: every result is within the commander's color
    identity (when the deck has one), legal in the deck's format (unless the format is casual),
    and not already in any of the deck's boards.
13. **Ranking is stable and explained**: more matched synergies first, then owned (> 0) before
    store-only, then lower store price, then name. Each card lists the synergies it matched.
14. **A query that found nothing or hit the cap says so**, with a hint naming what to loosen or
    narrow.
15. **Every cookbook query and every example in a tool description parses with no notes.**
16. **Tokens are limited to 10 live ones per player**; `last_used_at` is written at most once a
    minute per token.
17. **Each land-cycle `is:` value matches its cycle and only it**: checked against a list of
    real cards per cycle (and near-misses, such as a check land not matching `is:fastland`).
18. **`o:` reads rules text without reminder text; `fo:` reads it with.** (A change for the web
    search too: `o:flying` no longer matches a card whose only "flying" is in a reminder.)
19. **An `otag:`/`function:` value either maps to a tag or theme, or is noted**; it never
    silently matches nothing.
20. **Revoking is automatic** when an admin resets a player's password or disables the player.

## 5. Use cases

### 5.1 Access tokens (accounts module)

| Use case         | Actor / authz       | Input                      | Output                        | Errors (`kind`)                           | Transaction? |
| ---------------- | ------------------- | -------------------------- | ----------------------------- | ----------------------------------------- | ------------ |
| `createToken`    | the player          | `{ name, scopes }`         | `NewAccessToken`              | `NameInvalid`, `TooManyTokens`            | yes          |
| `revokeToken`    | the token's owner   | `tokenId`                  | `void`                        | `TokenNotFound` (also for someone else's) | yes          |
| `actorFromToken` | none (it's sign-in) | the `Authorization` header | `TokenActor \| null`          | none: null for anything wrong (rule 1)    | read + touch |
| `listTokens`     | the player          | (query)                    | `AccessToken[]`, newest first | —                                         | read         |

### 5.2 LLM tools

Read tools (scope `read`):

| Tool               | Input (beyond paging)                | Wraps                                                                                                                  |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `get_account`      | —                                    | `walletSummary`, allowance outlook, counts of cards, decks, wishes                                                     |
| `list_decks`       | —                                    | `decksFor`                                                                                                             |
| `get_deck`         | `deckId`, `includeText`              | `deckView`, `deckStats`, `roleTargets`, `deckProblems`, `shortList`, `deckTokenLines`, `fingerprint`                   |
| `search_for_deck`  | section 3.3                          | `deckBrowseContext` + `searchCondition` over owned copies and the store                                                |
| `search_cards`     | `search`, `where`, `sort`            | `collectionPage` (owned) and `searchPrintings` + `printingCards` (store), no deck rules                                |
| `get_card`         | `printingId` or `name`               | `printingDetail`, `cardPrintings`, `priceHistory` (first, low, high, now), owned copies, `decksUsing`, `wishesForCard` |
| `get_collection`   | `search`, `includeReal`, `sort`      | `collectionPage`                                                                                                       |
| `analyze_cards`    | `deckId` or `search`, `minimumCards` | section 3.7: recurring counters, tokens, types, triggers, costs and phrases, each with a follow-up search              |
| `suggest_for_deck` | `deckId`                             | `deckSuggestions` (profile, gaps, owned and store picks, reasons)                                                      |
| `similar_cards`    | `deckId`, `oracleId`                 | `similarCards`                                                                                                         |
| `budget_upgrades`  | `deckId`, `budget` (cents)           | `budgetList`                                                                                                           |
| `cards_to_get`     | —                                    | `cardsToGetFor`                                                                                                        |
| `get_wishlist`     | —                                    | `wishlistAnswers`                                                                                                      |
| `list_sets`        | —                                    | `enabledSets`                                                                                                          |
| `get_search_guide` | `topic: "syntax" \| "cookbook"`      | the `/search-help` rows and the cookbook (section 3.5)                                                                 |

Write tools:

| Tool                | Scope            | Wraps                                                    | Notes                                                     |
| ------------------- | ---------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `create_deck`       | `decks:write`    | `decks.createDeck`, or `createDeckFromCards` with a list | returns the new deck's id                                 |
| `update_deck`       | `decks:write`    | `decks.updateDeck`                                       | name, format, "use my real cards"                         |
| `set_deck_entry`    | `decks:write`    | `decks.setEntry`                                         | card, quantity (0 removes), board                         |
| `replace_deck_list` | `decks:write`    | `decks.replaceList`                                      | needs `fingerprint` (rule 11); returns the replace report |
| `choose_printing`   | `decks:write`    | `decks.choosePrinting`                                   |                                                           |
| `add_wish`          | `wishlist:write` | `wishlist.addWish`                                       | any printing or exact; optional target price              |
| `update_wish`       | `wishlist:write` | `wishlist.updateWish`                                    |                                                           |
| `remove_wish`       | `wishlist:write` | `wishlist.removeWish`                                    |                                                           |

23 tools. Optional MCP extras (clients that show them; never required, rule 10): resources
`proxylib://search-syntax` and `proxylib://synergy-cookbook`, prompts `find_synergies(deckId,
goal?)`, `build_deck(format, commander, budget?)` and `improve_deck(deckId)`.

## 6. Ports

Accounts gains one repository port and one generator method; the tools need no new ports (they
use the container, as server actions do).

```ts
interface AccessTokenRepository {
  countLive(userId: UserId): Promise<number>;
  insert(token: AccessToken, hash: string): Promise<AccessTokenId>;
  findLiveByHash(hash: string): Promise<AccessToken | null>;
  revoke(id: AccessTokenId, userId: UserId, at: Date): Promise<boolean>; // false: not theirs / gone
  touch(id: AccessTokenId, at: Date): Promise<void>;
}

interface SecretGenerator {
  inviteCode(): InviteCode;
  temporaryPassword(): Password;
  accessTokenBytes(): Uint8Array; // 32 bytes from crypto.getRandomValues (new)
}
```

Adapters: `drizzleAccessTokenRepository` (`accounts/infrastructure`), the existing
`cryptoSecretGenerator`; fakes in `accounts/testing`.

## 7. State machines

A token: **live** → (revoke) → **revoked**. Revoked is final. No expiry in this phase
(decision 4).

## 8. Persistence

New table, owned by accounts:

```sql
create table access_tokens (
  id            serial primary key,
  user_id       text not null references auth_users(id) on delete cascade,
  name          text not null,
  prefix        text not null,
  token_hash    text not null unique,
  scopes        text[] not null,
  created_at    timestamptz not null,
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index access_tokens_live on access_tokens (user_id) where revoked_at is null;
```

Migration by `pnpm db:generate`. Nothing else changes in the schema: `tag:` and `theme:` read
the existing `printings.role_tags` / `printings.theme_tags` columns and their GIN indexes
(ADR 0019).

## 9. Read models (queries)

- **`/account/tokens`** (new page, linked from Account): the list (name, prefix, scopes, created,
  last used, Revoke), the create form (name, two scope checkboxes, `read` always on), and after
  creating: the secret once, with a Copy button and "you won't see this again".
- **"Connect an LLM"** panel on the same page: the two endpoint URLs (from `APP_URL`), and
  copy-ready snippets: a generic MCP client config (`{ "url": …, "headers": { "Authorization":
"Bearer …" } }`), the `npx mcp-remote <url> --header "Authorization: Bearer …"` bridge for
  clients that only start local stdio servers, and the OpenAPI URL. Labelled as examples, not a
  list of supported apps.
- **`/search-help`**: adds the `tag:` and `theme:` rows. Its rows move to a shared data file so
  the page and `get_search_guide` print the same reference.
- Tool outputs reuse the existing view types, shaped by `format.ts`: money as `MoneyView`, cards
  in a compact form (`name, oracleId, printingId, set, number, manaCost, typeLine, colors,
price, owned`), text only when asked.

## 10. Events emitted

None to the activity feed. Deck and wishlist changes made through a tool are the same use cases
the web UI calls, so whatever those record today, they still record. (Whether the feed should say
"via an LLM" is decision 6.)

## 11. Patterns applied

- **Ports & adapters**: the registry is the application-facing core of this phase; MCP and HTTP
  are two driving adapters, like server actions. A third (a future chat box, a CLI) would be one
  more file.
- **Thin controllers** (patterns.md): parse → actor → use case → map `Result`, as in
  `src/app/decks/actions.ts`.
- **Schemas as contracts**: one Zod schema per tool gives runtime validation, TypeScript types,
  the MCP `inputSchema` and the OpenAPI operation (zod 4's `z.toJSONSchema`).
- **CQRS-lite** (ADR 0006): read tools call queries directly; write tools call use cases.
- **Functional core**: token rules, merging and ranking hits, query hints are pure and unit
  tested.
- **Data as configuration**: the cookbook is a typed table, tested like the tag rules.
- **Deviation:** the registry lives in `src/server/` (app layer), not in a module, because it
  composes many modules, like the composition roots. It may import any module's `index.ts`.

## 12. Test plan

- **Domain unit tests:** `tokenSecret` shape and length; `looksLikeToken` rejects near-misses;
  `tokenHash` is stable; `withRead`; `allows`; `shouldTouch` around the minute.
- **Pure tool parts:** `mergeHits` (a card in two queries lists both synergies, once each);
  `rankFound` order (rule 13), property test that it's a permutation and stable; `queryHint` for
  0, capped and fine.
- **Signals (section 3.7):** each rule on real card text (spore counters on Shroofus-style cards,
  Saproling and Treasure tokens, dies triggers); reminder text and the card's own name never make
  a signal; recurring phrases need `minimumCards` distinct cards and skip what a named signal
  already covers; every follow-up search parses with no notes.
- **Search language (section 3.6):** parse tests for every new keyword and `is:` value, field
  comparisons (`pow>tou`), `mv:even`, `~`, `otag:` aliases and the note for unknown ones. SQL
  integration tests on seeded printings: each land cycle against real examples and near-misses
  (rule 17), `o:` vs `fo:` with reminder text (rule 18), `banned:`, `tag:`/`theme:`.
- **Cookbook and examples:** every query in the cookbook and in every tool description parses
  with no notes (rule 15).
- **Registry tests:** every tool's JSON Schema passes the compatibility rules (rule 9); every
  description has the section headings (3.4); the write tools are exactly the list in 5.2
  (rule 5); names are unique and `verb_noun`.
- **Use-case tests (fakes):** `createToken` returns the secret once and stores only the hash;
  `TooManyTokens` at 10; `revokeToken` of someone else's token is `TokenNotFound`;
  `actorFromToken` null for a wrong, revoked, disabled-player and must-change-password token.
- **Integration (real database):**
  - The MCP server through the SDK's in-memory client transport: `tools/list` matches the
    registry; each read tool on seeded data; `search_for_deck` respects color identity,
    legality and "not in the deck" (rule 12) on a seeded R/G commander deck; write tools change
    decks and wishes; stale fingerprint → `DeckChanged`; missing scope → error.
  - The HTTP routes: 401 without a token, with a revoked token; 403 without scope; 422 with an
    expected error; `openapi.json` operations match `tools/list` (rule 6).
  - `drizzleAccessTokenRepository` contract test against the fake.
- **E2E:** create a token on `/account/tokens`, see it once, see it listed, revoke it; screenshots
  in dark mode and at phone width.
- **By hand (not automated):** connect two clients from different vendors, one with a local
  model; run the Jolene request (section 1) and compare with the earlier Scryfall result.

## 13. Decisions (review, 2026-11-07)

Every recommendation accepted:

1. **Tokens now, OAuth later**, as its own phase if claude.ai or ChatGPT web connectors are
   wanted.
2. **Writes are decks and wishlist only.** No buying, even of wishes.
3. **Two endpoints** (MCP and OpenAPI) from one registry.
4. **Tokens never expire**; they are revoked by hand, and the list shows when each was last used.
5. **Automatic revocation:** an admin "reset password" and disabling a player revoke the
   player's tokens. Start over (design doc 12) does not.
6. **No feed events** for changes made through tools.
7. **This catalog only**, not all of Scryfall; the instructions say so.
8. **`tag:` and `theme:` in the web search too**, and more: the search language grows as far as
   the stored data allows (section 3.6, added at review).
9. **Limits:** 8 queries × 50 cards per `search_for_deck` call, 200 merged, pages of 25 (max
   100).
10. **No rate limiting** beyond those bounds; add a per-token limit if a client loops.
