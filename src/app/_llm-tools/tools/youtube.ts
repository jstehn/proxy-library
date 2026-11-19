import { z } from "zod";
import { DECK_TECH_SEARCH_KINDS, SEARCH_SORT_MODES } from "@/modules/youtube";
import { defineTool, done, failed } from "../tool";

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
