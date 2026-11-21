# Design: YouTube Video Search & Transcript Tools for Deck Techs

- **Phase:** 64
- **Status:** **Approved** (2026-11-18 — module in `src/modules/youtube/`, `includeTimestamps` defaults to `false`)
- **Superseded** (2026-11-20, P22): by docs/modules/llm-tools.md
- **Related ADRs:** 0003 (Result types), 0007 (External data behind an ACL), 0009 (Lint-enforced boundaries), 0022 (LLM tool registry over MCP & OpenAPI)
- **Lesson:** no

## 1. Purpose & scope

Give any LLM connected to Proxy Library (via `/api/mcp` or `/api/tools/<name>`) two read-only research tools:

1. **Discover** YouTube deck techs, commander spotlights, budget upgrade guides, and archetype reviews (`search_youtube_deck_techs`).
2. **Pull transcripts** from any YouTube video URL or 11-character video ID (`get_youtube_transcript`), formatted and paged to fit cleanly inside an LLM context window.

### How it is used for deck building

When a player asks an LLM to build, tune, or review a deck (e.g., _"Find a good Henzie deck tech and compare it to what I own"_ or _"Summarize this commander guide and suggest budget swaps"_):

1. **Discover videos:** The LLM calls `search_youtube_deck_techs` with a commander name or archetype (e.g., `"Henzie Toolbox Torre"` or `"Dimir Mill"`).
2. **Read transcripts:** The LLM calls `get_youtube_transcript` with a video URL or ID (paging via `cursor` if the video is long).
3. **Extract & verify:** The LLM extracts recommended cards, synergies, win conditions, mulligan heuristics, budget swaps, and pilot notes from the creator's commentary—then verifies every card against Proxy Library's own catalog, ownership, and rules (`check_owned`, `search_for_deck`, `get_cards`, `lookup_rules`) before proposing edits via `apply_changes`.
4. **Cite sources:** The LLM records helpful video URLs on the deck via `deck_sources` and can fold distilled strategy into `set_primer` / `set_deck_profile`.

**Out of scope:**

- Downloading audio/video or running local speech-to-text (Whisper) when a video has no captions.
- Persisting full transcripts in PostgreSQL (only a bounded in-memory TTL cache so `cursor` pagination does not re-fetch YouTube on every page).
- Private, age-gated, or members-only videos requiring YouTube OAuth.
- Parsing YouTube video descriptions or pinned comments for decklists (can be a small follow-up if needed).

---

## 2. Review of existing public tools & libraries

Before building, we reviewed the current Node.js/TypeScript ecosystem and existing MCP servers:

| Option                                                                                                                                                 | Capabilities                                                                           | Pros                                                                                                                                                                      | Cons / Fit for Proxy Library                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`youtube-transcript`** / **`youtube-transcript-plus`** / **`yt-caption-kit`**                                                                        | Transcript scraping only                                                               | Minimal dependency, zero API key                                                                                                                                          | No video search; relies on fragile watch-page HTML scraping that breaks when YouTube changes player JSON.                                                                                                                                  |
| **`youtube-sr`**                                                                                                                                       | Video search scraping only                                                             | Simple flat JSON output, zero API key                                                                                                                                     | No transcript fetching; would require pairing a second library.                                                                                                                                                                            |
| **YouTube Data API v3** (official)                                                                                                                     | Search + metadata                                                                      | Official, stable quota-backed search                                                                                                                                      | Requires user/server Google API key; `captions.download` **only** works for videos owned by the authenticated channel (cannot fetch third-party deck techs).                                                                               |
| **Standalone MCP servers** (`@sinco-lab/mcp-youtube-transcript`, `@kimtaeyoon83/mcp-server-youtube-transcript`, `@alexspalato/youtube-transcript-mcp`) | Transcript-only stdio MCP                                                              | Ready-made for local Claude Desktop                                                                                                                                       | Separate process (not available over Proxy Library's `/api/mcp` or `/api/tools/*` OpenAPI endpoints); no YouTube search; no Proxy Library `INSTRUCTIONS` or `deck_sources` workflow integration; no shared 40 KB `capToolResponse` paging. |
| **`youtubei.js`** (LuanRT InnerTube client)                                                                                                            | **Both** search (`youtube.search`) and transcripts (`info.getTranscript()`) + metadata | Actively maintained TypeScript client emulating YouTube's internal InnerTube API (Web/Android); zero API key; rich structured metadata (title, channel, duration, views). | Larger dependency than a tiny scraper; response objects are verbose (easily normalized behind an ACL).                                                                                                                                     |

**Decision:** Use **`youtubei.js`** for video search & metadata (`youtube.search`, `youtube.getBasicInfo`) paired with **`youtube-transcript-plus`** for transcript retrieval (`fetchTranscript`), both hidden behind a single Anti-Corruption Layer (`YouTubeGateway` port, ADR 0007). In live testing, `youtubei.js`'s `getTranscript()` endpoint hit `400 FAILED_PRECONDITION` on anonymous requests, whereas `youtube-transcript-plus` reliably retrieved auto-generated and manual captions without an API key or BotGuard/JSDOM overhead.

---

## 3. Ubiquitous language

| Term               | Meaning in this codebase                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `YouTubeVideoId`   | Branded 11-character YouTube video identifier (`[A-Za-z0-9_-]{11}`).                                                                                   |
| Transcript segment | One timed caption entry: `{ text, startSec, durationSec }`.                                                                                            |
| Deck tech query    | A search query shaped for MTG/Commander content (e.g. appending `"MTG Commander deck tech"` when the caller gives a bare commander or archetype name). |
| Cursor pagination  | Byte-bounded paging (`~30–40 KB` per response) over long transcripts so multi-hour podcasts/primers don't overflow LLM context.                        |

---

## 4. Domain model (pure, no I/O)

Location: `src/modules/youtube/domain/` (or `src/server/youtube/domain/` if kept as a lightweight research utility outside game-state modules—see Open Questions).

```ts
export type YouTubeVideoId = Brand<string, "YouTubeVideoId">;

export type ParseVideoIdError = Readonly<{
  kind: "InvalidVideoInput";
  message: string;
}>;

/**
 * Extracts a 11-char YouTube video ID from:
 * - Raw ID: `dQw4w9WgXcQ`
 * - Watch URL: `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s`
 * - Short URL: `https://youtu.be/dQw4w9WgXcQ`
 * - Shorts / Live / Embed URLs: `youtube.com/shorts/<id>`, `youtube.com/live/<id>`, `youtube.com/embed/<id>`
 */
export function parseYouTubeVideoId(input: string): Result<YouTubeVideoId, ParseVideoIdError>;

export type TranscriptSegment = Readonly<{
  text: string;
  startSec: number;
  durationSec: number;
}>;

export type VideoTranscript = Readonly<{
  videoId: YouTubeVideoId;
  url: string;
  title: string;
  channel: string;
  durationSec: number | null;
  language: string;
  isAutoGenerated: boolean;
  segments: readonly TranscriptSegment[];
}>;

export type DeckTechSearchKind = "deck_tech" | "guide" | "gameplay" | "any";

export type YouTubeSearchResult = Readonly<{
  videoId: YouTubeVideoId;
  url: string;
  title: string;
  channel: string;
  durationSec: number | null;
  durationText: string | null;
  publishedText: string | null;
  viewCountText: string | null;
}>;
```

### Pure query shaping & transcript formatting

1. **`buildDeckTechQuery(query: string, kind: DeckTechSearchKind): string`**
   - Trims whitespace; rejects empty queries.
   - If `kind !== "any"` and the query doesn't already contain MTG/EDH keywords (`mtg`, `commander`, `edh`, `deck tech`, `primer`, `guide`, `gameplay`, `cedh`), appends context terms:
     - `"deck_tech"` → `${query} MTG Commander deck tech`
     - `"guide"` → `${query} MTG Commander guide primer`
     - `"gameplay"` → `${query} MTG Commander gameplay`
   - If the caller already wrote an explicit query (e.g. `"Henzie Blitz cEDH primer"`), passes it through unmodified.

2. **`formatTranscriptPage(transcript: VideoTranscript, opts: { includeTimestamps: boolean; cursor: number; maxBytes: number })`**
   - Normalizes whitespace and decodes common HTML entities in caption text.
   - If `includeTimestamps` is `true`, formats each segment as `[MM:SS] <text>` (or `[HH:MM:SS]`).
   - If `includeTimestamps` is `false`, joins segments into readable paragraphs/lines.
   - Slices by whole segments/lines up to `maxBytes` (default `32_000`, safely under `MAX_TOOL_RESPONSE_BYTES = 40_000`), returning `{ text, nextCursor, totalSegments, returnedSegments }`.

---

## 5. Invariants

1. `parseYouTubeVideoId` accepts all standard YouTube URL formats (`watch`, `youtu.be`, `shorts`, `live`, `embed`, `m.youtube.com`, `music.youtube.com`) and raw 11-character IDs, and rejects arbitrary URLs or malformed IDs with `InvalidVideoInput`.
2. `buildDeckTechQuery` never duplicates keywords already present in the user's query (idempotent when called with an already-qualified MTG query).
3. `formatTranscriptPage` never splits mid-segment or mid-UTF8 character, and every page fits strictly within `maxBytes`.
4. Paging from `cursor = 0` through `nextCursor` until `nextCursor === undefined` visits every segment in order with zero gaps and zero duplicates.
5. Tool responses never leak raw InnerTube / library stack traces; upstream failures map to actionable `ToolError` kinds (`InvalidVideoInput`, `VideoNotFound`, `TranscriptUnavailable`, `RateLimited`, `UpstreamError`).

---

## 6. Ports & infrastructure (ADR 0007)

```ts
export type YouTubeError =
  | Readonly<{ kind: "InvalidVideoInput"; message: string }>
  | Readonly<{ kind: "VideoNotFound"; message: string }>
  | Readonly<{ kind: "TranscriptUnavailable"; message: string }>
  | Readonly<{ kind: "RateLimited"; message: string }>
  | Readonly<{ kind: "UpstreamError"; message: string }>;

export type YouTubeGateway = Readonly<{
  searchVideos(params: {
    query: string;
    limit: number;
  }): Promise<Result<readonly YouTubeSearchResult[], YouTubeError>>;

  fetchTranscript(params: {
    videoId: YouTubeVideoId;
    lang: string;
  }): Promise<Result<VideoTranscript, YouTubeError>>;
}>;
```

- **Adapter (`YoutubeiGateway`):** Wraps `youtubei.js` (`Innertube.create()` for `searchVideos` and `getBasicInfo` metadata) and `youtube-transcript-plus` (`fetchTranscript` for caption segments).
- **Language fallback:** Requests the requested `lang` (default `"en"`), falling back to English auto-generated captions or the first available track (reporting the actual `language` and `isAutoGenerated` flag in the response).
- **In-memory TTL cache:** Bounded LRU cache (e.g., max 50 transcripts, 20-minute TTL) keyed by `${videoId}:${lang}`. Prevents redundant YouTube requests when an LLM pages through a long video with `cursor`.

---

## 7. LLM tool contracts & deck-building discoverability

Both tools are registered in `src/app/_llm-tools/registry.ts` (served over both `/api/mcp` and `/api/tools/<name>`), with `scope: "read"` and `readOnly: true`.

### 7.1 `search_youtube_deck_techs`

- **Title:** `Search YouTube Deck Techs & Guides`
- **Description (written for the LLM):**
  > Search YouTube for Magic: The Gathering deck techs, commander spotlights, archetype primers, and budget upgrade guides. Use this when researching a commander or archetype before building or tuning a deck. Automatically adds MTG/Commander search context unless your query already includes it (set `kind: "any"` for exact raw search). Follow up by passing a promising `videoId` or `url` to `get_youtube_transcript` to read the creator's card choices, synergies, and pilot notes, then verify suggested cards against Proxy Library's catalog (`check_owned`, `search_for_deck`, `get_cards`).
- **Input schema (flat Zod object):**
  - `query`: `string` (1–200 chars; commander name, archetype, or search phrase)
  - `kind`: `enum(["deck_tech", "guide", "gameplay", "any"]).default("deck_tech")`
  - `limit`: `integer` (1–15, default `8`)

### 7.2 `get_youtube_transcript`

- **Title:** `Get YouTube Video Transcript`
- **Description (written for the LLM):**
  > Fetch the spoken transcript and metadata (title, channel, duration) of a YouTube video from its URL or 11-character video ID. Use this for deck-building research: ingest video deck techs, commander reviews, budget upgrade videos, and archetype primers to extract recommended cards, win conditions, cut/add reasoning, and pilot tips. Because creators may mention cards outside this catalog or target bracket, always verify extracted cards with `check_owned`, `get_cards`, and `deck_facts` before suggesting changes, and save cited video URLs with `deck_sources`. Long videos are paged; pass `nextCursor` as `cursor` to read the next section.
- **Input schema (flat Zod object):**
  - `video`: `string` (YouTube URL or 11-character video ID)
  - `lang`: `string` (optional ISO 639-1 code, default `"en"`)
  - `includeTimestamps`: `boolean` (optional, default `false`)
  - `cursor`: `integer` (optional, `>= 0`, default `0`)

### 7.3 `INSTRUCTIONS` update (`src/app/_llm-tools/registry.ts`)

Update step `(2)` of `INSTRUCTIONS` in `src/app/_llm-tools/registry.ts` to include the new tools alongside existing evidence tools:

> `(2) Gather outside evidence (edhrec_commander, compare_to_edhrec, search_youtube_deck_techs, get_youtube_transcript, find_combos, get_rulings, lookup_rules, guides) and cite it.`

---

## 8. Patterns applied

- **Anti-Corruption Layer (ADR 0007):** `YouTubeGateway` isolates `youtubei.js` types and errors from the rest of the app.
- **Result types (ADR 0003):** Expected failures (`TranscriptUnavailable`, `VideoNotFound`, `RateLimited`, `InvalidVideoInput`) return `Result` values mapped to clear `ToolError` messages.
- **Single Tool Registry (ADR 0022):** Defining both tools once in `src/app/_llm-tools/tools/youtube.ts` exposes them on both MCP and OpenAPI endpoints with identical Zod schemas and byte-capped pagination (`pagesItself: true`).

---

## 9. Test plan

- **Domain unit & property tests:**
  - `parseYouTubeVideoId`: all URL shapes (`watch?v=`, `youtu.be/`, `shorts/`, `live/`, `embed/`, query params like `&t=`, raw IDs) and invalid inputs.
  - `buildDeckTechQuery`: bare commander names, archetype names, queries that already contain MTG/EDH terms, `kind: "any"`.
  - `formatTranscriptPage`: plain-text vs `[MM:SS]` timestamps, HTML entity cleanup, property test that paging with `nextCursor` reconstructs all segments within `maxBytes`.
- **Application / tool tests (with fake `YouTubeGateway`):**
  - `search_youtube_deck_techs`: query shaping, limit clamping, upstream error mapping.
  - `get_youtube_transcript`: URL parsing, language reporting, `cursor` paging, `TranscriptUnavailable` / `VideoNotFound` error messages.
- **Full check:** `pnpm check` (typecheck, lint, lint:cycles, format:check, unit tests).

---

## 10. Open questions

1. **Module placement:** Should this live under `src/modules/youtube/` (a small standalone bounded context with no DB tables, registered in `src/server/core.ts`) or directly under `src/server/youtube/`? Putting it in `src/modules/youtube/` matches ADR 0001 and `eslint-plugin-boundaries` cleanly.
2. **Default `includeTimestamps`:** Should `get_youtube_transcript` default to `false` (cleaner prose, ~20% fewer tokens per page) or `true` (lets the LLM cite timestamps like `12:34` in `deck_sources` / `set_primer`)? Proposed default: `false`, with `includeTimestamps: true` available when timestamp citations are desired.
