import { z } from "zod";
import { REDDIT_SORT_MODES, REDDIT_TIMEFRAMES } from "@/modules/reddit";
import { defineTool, done, failed } from "../tool";

export const redditResearchTool = defineTool({
  name: "reddit_research",
  title: "Reddit MTG discussion search & thread reader",
  description:
    "Search MTG/Commander subreddits (with `query`) or read a Reddit post and its comments (with `post` URL/ID). Pass `nextCursor` as `cursor` for long threads.",
  scope: "read",
  readOnly: true,
  pagesItself: true,
  input: z.object({
    query: z.string().min(1).max(200).optional().describe("Search phrase (e.g. commander name)."),
    post: z.string().min(1).max(500).optional().describe("Reddit post URL or post ID."),
    subreddit: z
      .string()
      .min(2)
      .max(100)
      .optional()
      .describe(
        "Subreddit(s) to search (default: EDH+CompetitiveEDH+BudgetBrews+magicTCG, or 'all').",
      ),
    sortBy: z
      .enum(REDDIT_SORT_MODES)
      .default("relevance")
      .describe("Search sort: 'relevance', 'top', 'new', or 'comments'."),
    timeframe: z
      .enum(REDDIT_TIMEFRAMES)
      .default("all")
      .describe("Search timeframe: 'all', 'year', 'month', 'week', or 'day'."),
    limit: z.number().int().min(1).max(15).default(8).describe("Max posts to return (1-15)."),
    commentSort: z
      .enum(["top", "best", "new"])
      .default("top")
      .describe("Thread comment sort: 'top', 'best', or 'new'."),
    commentLimit: z
      .number()
      .int()
      .min(5)
      .max(80)
      .default(40)
      .describe("Max comments to fetch (5-80)."),
    cursor: z.number().int().min(0).default(0).describe("Item cursor for paging long threads."),
  }),
  async run(context, input) {
    if (input.post) {
      const result = await context.container.reddit.getThread({
        post: input.post,
        commentSort: input.commentSort,
        commentLimit: input.commentLimit,
        cursor: input.cursor,
      });
      return result.ok ? done(result.value) : failed(result.error.kind, result.error.message);
    }
    if (input.query) {
      const result = await context.container.reddit.searchPosts({
        query: input.query,
        subreddit: input.subreddit,
        sortBy: input.sortBy,
        timeframe: input.timeframe,
        limit: input.limit,
      });
      return result.ok ? done(result.value) : failed(result.error.kind, result.error.message);
    }
    return failed(
      "InvalidInput",
      "Provide `query` to search Reddit posts or `post` to read a thread.",
    );
  },
});
