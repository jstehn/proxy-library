# LLM tools (MCP and OpenAPI)

The 16 tools a model uses to read and edit a player's decks and wishlist, served identically as MCP
(`/api/mcp`) and as OpenAPI (`/api/tools/<name>`). Code: `src/app/_llm-tools/` (bindings over
capabilities, ADR 0026 and ADR 0022), tokens and OAuth in `src/modules/accounts/`, outside research
in `src/modules/youtube/` and `src/modules/reddit/`. Checked against `refactor/main` (2026-11-20) by
the tests named in brackets. Owner decisions: tools never show scores or ranks, and tool output is
designed to use few tokens (D1, 2026-11-19).

The tools are `get_account`, `list_decks`, `get_deck`, `create_deck`, `update_deck`, `edit_deck`,
`get_cards`, `search_cards`, `find_replacements`, `find_combos`, `draw_sample`, `manage_wishlist`,
`rules_lookup`, `edhrec_lookup`, `youtube_research`, `reddit_research`.

## Authority

1. **A token stands for exactly one active player.** A revoked token, a disabled player's token or a
   player who must change their password gets the same 401 as a wrong token. Tokens are `pl_` plus 43
   base64url characters; only the SHA-256 is stored; the secret is shown once at creation and is never
   logged. (doc 28 §4 rules 1-2; `access-tokens.test.ts`, `access-token.test.ts`)
2. **Every call checks the tool's scope first;** a token without it gets 403 naming the scope and
   nothing runs. `read` is always included. (doc 28 §4 rule 3; `bindings.test.ts`,
   `access-token.test.ts`)
3. **Tools add no business rules:** every read goes through an existing capability or query and every
   write through an existing use case with the token's actor, so ownership, legality, limits and
   validation are the web UI's. (doc 28 §4 rule 4; ADR 0026)
4. **Writes are decks and the wishlist only.** No tool buys, moves money, cards or sealed items,
   deletes a deck (a delete needs `confirm`), or touches another player's data. The registry test
   lists the allowed write tools, so adding one fails it. (doc 28 §4 rule 5, §13.2;
   `registry.test.ts`, `bindings.test.ts`)
5. **At most 10 live tokens per player,** `last_used_at` is written at most once a minute per
   token; tokens never expire and are revoked by hand; they are revoked automatically when an admin
   resets the player's password or disables the player (Start over does not). (doc 28 §4 rules 16
   and 20, §13.4-5; `access-tokens.test.ts`)
6. **Edits from a stale view are refused:** `edit_deck` / replace needs the deck's `fingerprint` from
   `get_deck` and returns `DeckChanged` if it moved on. A stored change preview applies by its id.
   (doc 28 §4 rule 11, doc 23 §4 rule 5; `bindings.test.ts`)

## Shape of the surface

7. **Both endpoints expose the same tools** with the same input schemas and descriptions.
   (doc 28 §4 rule 6; `registry.test.ts`)
8. **Schemas stay simple for small models:** a flat object, no `oneOf`/`anyOf`/`allOf`, enums for
   choices, a description on every field, defaults where sensible. Tool names are unique `verb_noun`.
   (doc 28 §4 rule 9; `registry.test.ts`, `bindings.test.ts`)
9. **Everything a model needs is in the descriptions and results;** the server instructions repeat
   the house rules but no tool depends on a client reading them. Every cookbook query and every
   search example in a description parses with no notes. (doc 28 §4 rules 10 and 15;
   `registry.test.ts`)
10. **Expected failures are answers, not crashes:** a `Result` error becomes a `ToolError` with a
    sentence saying what to do next (MCP `isError: true`, HTTP 422); defects throw and are 500s.
    Error text lives in one place per module (`describe-error`). (doc 28 §4 rule 8, S7;
    `describe-error.test.ts` files)
11. **Responses are bounded.** A response is capped at 14,000 bytes: the largest array is paged with
    a `next` cursor, and bulky secondary fields are dropped first. A query that finds nothing or hits
    its cap says so and what to loosen or narrow. (doc 28 §4 rules 7 and 14, doc 61 §4 rule 7;
    `cap-response.test.ts`) See the disagreement below about the figure.
12. **Output is small and shows no scores:** compact money (cents), at most three short reasons, no
    rating, rank or internal id fields; descriptions say tool output is "ideas to consider, not
    recommendations". (owner D1; `bindings.test.ts`, `replacements.test.ts`)

## Search and deck reads

13. **`search_cards`** has three modes (syntax, semantic, signals). `search_for_deck`-style queries
    stay inside the deck: within the commander's colour identity, legal in the deck's format unless
    casual, not already on any board, avoid cards left out; each card lists the synergies it matched
    (omitted when a single unnamed `search` is used). Syntax searches (deck, batched `queries`, or
    plain catalog/collection) accept optional `sort` (`price_desc`, `added_desc`, `mv`, `name`) and
    omit empty metadata fields (`notes`, `hint`, `capped: false`, `leftOutOverTarget`, `pageCount: 1`)
    to keep responses compact.
    (doc 28 §4 rules 12-13, doc 54 §4 rule 1, doc 58 §4 rule 2, doc 71; `search-for-deck.test.ts`)
14. **The search language** (`@/shared/card-search`, ADR 0017): `o:` reads rules text without
    reminder text, `fo:` with it; each land-cycle `is:` value matches its cycle only (checked against
    real cards and near-misses); an `otag:`/`function:` value maps to a tag or theme or is noted, never
    silently matching nothing; every theme has real-card matches and near-misses in its test and is
    accepted by both `theme:` and `otag:`. (doc 28 §4 rules 17-19, doc 38 §6; `tags.test.ts`,
    `parse.test.ts`)
15. **`get_deck`** returns a compact deck by default; facts (stats, bracket estimate, problems,
    tokens) are opt-in. `find_combos` classes a combo "complete" only when every piece is on a
    counted board, and keeps its one-card-away partners within the deck's target bracket (brackets 1-2 allow none). `draw_sample` follows `decks-play.md`. (doc 61 §4 rule 6, doc 54
    §4 rule 4; `bindings.test.ts`, `deck-research.test.ts`)

## Outside research

16. **`youtube_research` and `reddit_research`** read the web, never a store of ours:
    - YouTube accepts every standard video URL form and a raw 11-character id, rejects anything
      else with `InvalidVideoInput`; a deck-tech query never repeats keywords already present;
      transcript pages never split a segment and always fit the byte cap; paging from 0 visits every
      segment once; timestamps are off by default; upstream failures map to actionable errors, never
      a stack trace. (doc 64 §5; `video-id.test.ts`, `search.test.ts`, `transcript.test.ts`)
    - Reddit defaults to the MTG subreddits, rejects invalid subreddit names and empty queries, and
      pages a thread without gaps or duplicates. (doc 61; `reddit/domain/*.test.ts`)
17. **`rules_lookup` and `edhrec_lookup`** read stored data (the Comprehensive Rules and EDHREC rows
    synced by the worker), never the network in a request; see `catalog.md`. (doc 60 §3.2, doc 45
    §4 rule 1; `bindings.test.ts`)

## Connectors (OAuth)

18. **Redirect URIs** are `https://`, or `http://localhost` / `127.0.0.1`, with no fragment, at most
    500 characters, exactly matched; a bad client id or redirect URI is never redirected to (the page
    shows an error). (doc 30 §4 rules 1-2; `oauth.test.ts`)
19. **PKCE with S256 is required.** A code is used once, lives ten minutes, only its SHA-256 is
    stored; an expired code, a wrong verifier or a code of another client is `invalid_grant`.
    (doc 30 §4 rules 3-4; `oauth.test.ts`)
20. **Only a signed-in, active player** can approve; the player chooses the scopes (`read` always
    included); the page shows the redirect host as well as the client's name; approving a client again
    replaces its earlier tokens, and the 10-token limit is explained before a code is given.
    (doc 30 §4 rules 5-7; `oauth.test.ts`)
21. **Confidential clients** (option A of doc 69, accepted by the owner): `client_secret_basic` and
    `client_secret_post`, a `pls_` secret shown once with only its hash stored, up to 20 exactly
    matched redirect URIs, admins create and delete them, and deleting a client revokes its tokens.
    (doc 69 §5; `oauth.test.ts`)

## Disagreements recorded here (for the project manager)

- **Response size:** doc 61 §4 rule 7 says no response exceeds about 40 KB; the code caps at 14,000
  bytes (`MAX_TOOL_RESPONSE_BYTES`). Code followed (owner, 2026-11-20: whatever is smaller and more effective). Doc 61 carries a "Superseded in part" line.
- **List limits:** doc 28 §4 rule 7 and §13.9 say pages of 25 (max 100) and `search_for_deck` 8
  queries x 50 cards, 200 merged; the code's `search_cards` takes up to 6 queries and a `limit` of
  1-20 (default 10), `get_cards` up to 100 names, `find_replacements` a limit of 1-20 (default 10).
  Decided 2026-11-20 (owner): batches save queries and tokens; the code stands. Doc 28 is marked.
- **Redirect URIs:** doc 30 §4 rule 1 says at most 5 per client; the code and doc 69 say 20. Decided 2026-11-20 (owner): 20; doc 30 is marked.
- **Tools in the docs that no longer exist:** doc 56 (`audit_deck`, `simulate_opening_hands`), doc
  57 (`upgrade_roadmap`, `diff_deck`), doc 47-rating (`suggest_swaps`), doc 59 (mulligan drill) and
  doc 60/61 (`goldfish_start`, `goldfish_step`). The 27 unregistered tools were removed on purpose
  (refactor decision 5); the goldfish by owner D3. Whether any of the others returns is open.
