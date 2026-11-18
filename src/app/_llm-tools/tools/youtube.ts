import { z } from "zod";
import { DECK_TECH_SEARCH_KINDS, SEARCH_SORT_MODES } from "@/modules/youtube";
import { defineTool, done, failed } from "../tool";

export const searchYoutubeDeckTechsTool = defineTool({
  name: "search_youtube_deck_techs",
  title: "Search YouTube Deck Techs & Guides",
  description:
    "Search YouTube for Magic: The Gathering deck techs, commander spotlights, archetype primers, and budget upgrade guides. Use this when researching a commander or archetype before building or tuning a deck. Automatically adds MTG/Commander context unless your query already includes it (set kind to 'any' for an unmodified search). Follow up by passing a promising videoId or url to get_youtube_transcript to extract card choices, synergies, and pilot notes, then verify those cards against Proxy Library's catalog (check_owned, search_for_deck, get_cards).",
  scope: "read",
  readOnly: true,
  input: z.object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "Commander name, archetype, or search phrase (e.g. 'Henzie Toolbox Torre' or 'Dimir Mill')",
      ),
    kind: z
      .enum(DECK_TECH_SEARCH_KINDS)
      .optional()
      .default("deck_tech")
      .describe(
        "Search intent: 'deck_tech' (default), 'guide' (primers/upgrades), 'gameplay', or 'any' (raw query)",
      ),
    sortBy: z
      .enum(SEARCH_SORT_MODES)
      .optional()
      .default("balanced")
      .describe(
        "Ranking mode: 'balanced' (default: recency-weighted popularity, filters out <3m clips, caps 2 per channel), 'relevance', 'views', or 'recent'",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(15)
      .optional()
      .default(8)
      .describe("Maximum number of videos to return (1-15, default 8)"),
  }),
  async run(context, input) {
    const result = await context.container.youtube.searchDeckTechs({
      query: input.query,
      kind: input.kind,
      sortBy: input.sortBy,
      limit: input.limit,
    });
    if (!result.ok) {
      return failed(result.error.kind, result.error.message);
    }
    return done(result.value);
  },
});

export const getYoutubeTranscriptTool = defineTool({
  name: "get_youtube_transcript",
  title: "Get YouTube Video Transcript",
  description:
    "Fetch the spoken transcript and metadata (title, channel, duration) of a YouTube video from its URL or 11-character video ID. Use this for deck-building research: ingest video deck techs, commander reviews, budget upgrade videos, and archetype primers to extract recommended cards, win conditions, cut/add reasoning, and pilot notes. Always verify extracted cards against this catalog with check_owned, get_cards, and deck_facts before proposing edits, and save cited video URLs with deck_sources. Long videos are paged; pass nextCursor as cursor to read the next section.",
  scope: "read",
  readOnly: true,
  pagesItself: true,
  input: z.object({
    video: z
      .string()
      .min(1)
      .max(500)
      .describe(
        "YouTube video URL (watch, youtu.be, shorts, live, embed) or 11-character video ID",
      ),
    lang: z
      .string()
      .min(2)
      .max(12)
      .optional()
      .default("en")
      .describe("Preferred caption language code (default 'en')"),
    includeTimestamps: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include [MM:SS] timestamps before each segment (default false for compact prose)"),
    cursor: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe(
        "Segment cursor for paging through long transcripts (use nextCursor from previous response)",
      ),
  }),
  async run(context, input) {
    const result = await context.container.youtube.getTranscript({
      video: input.video,
      lang: input.lang,
      includeTimestamps: input.includeTimestamps,
      cursor: input.cursor,
    });
    if (!result.ok) {
      return failed(result.error.kind, result.error.message);
    }
    return done(result.value);
  },
});

export const youtubeResearchTool = defineTool({
  name: "youtube_research",
  title: "YouTube deck tech search & transcript",
  description:
    "Search YouTube MTG deck techs/guides (with `query`) or fetch a video transcript (with `video` URL/ID). Pass `nextCursor` as `cursor` for long transcripts.",
  scope: "read",
  readOnly: true,
  pagesItself: true,
  input: z.object({
    query: z.string().min(1).max(200).optional().describe("Search phrase (e.g. commander name)."),
    video: z.string().min(1).max(500).optional().describe("YouTube URL or 11-char video ID."),
    kind: z
      .enum(DECK_TECH_SEARCH_KINDS)
      .default("deck_tech")
      .describe("Search intent: 'deck_tech', 'guide', 'gameplay', or 'any'."),
    sortBy: z
      .enum(SEARCH_SORT_MODES)
      .default("balanced")
      .describe("Ranking: 'balanced', 'relevance', 'views', or 'recent'."),
    limit: z.number().int().min(1).max(10).default(5).describe("Max videos to return (1-10)."),
    lang: z.string().min(2).max(12).default("en").describe("Caption language code."),
    includeTimestamps: z.boolean().default(false).describe("Include [MM:SS] timestamps."),
    cursor: z.number().int().min(0).default(0).describe("Segment cursor for long transcripts."),
  }),
  async run(context, input) {
    if (input.video) {
      const result = await context.container.youtube.getTranscript({
        video: input.video,
        lang: input.lang,
        includeTimestamps: input.includeTimestamps,
        cursor: input.cursor,
      });
      return result.ok ? done(result.value) : failed(result.error.kind, result.error.message);
    }
    if (input.query) {
      const result = await context.container.youtube.searchDeckTechs({
        query: input.query,
        kind: input.kind,
        sortBy: input.sortBy,
        limit: input.limit,
      });
      return result.ok ? done(result.value) : failed(result.error.kind, result.error.message);
    }
    return failed(
      "InvalidInput",
      "Provide `query` to search videos or `video` to get a transcript.",
    );
  },
});
