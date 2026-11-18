import { ok, type Result } from "@/shared/kernel";
import {
  buildRedditSearchQuery,
  formatThreadPage,
  normalizeSubreddit,
  parseRedditPostId,
  type RedditPostId,
  type RedditSearchPost,
  type RedditSortMode,
  type RedditTimeframe,
} from "../domain";
import type { RedditError, RedditGateway } from "./ports";

export type SearchRedditOutput = Readonly<{
  queryUsed: string;
  subreddit: string;
  results: readonly RedditSearchPost[];
}>;

export type GetRedditThreadOutput = Readonly<{
  postId: RedditPostId;
  url: string;
  subreddit: string;
  title: string;
  author: string;
  score: number;
  numComments: number;
  createdUtc: number;
  content: string;
  cursor: number;
  nextCursor?: number;
  returnedItems: number;
  totalItems: number;
}>;

const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 15;
const DEFAULT_COMMENT_LIMIT = 40;
const MAX_COMMENT_LIMIT = 80;

export function makeReddit(deps: { gateway: RedditGateway }) {
  return {
    async searchPosts(input: {
      query: string;
      subreddit?: string;
      sortBy?: RedditSortMode;
      timeframe?: RedditTimeframe;
      limit?: number;
    }): Promise<Result<SearchRedditOutput, RedditError>> {
      const sub = normalizeSubreddit(input.subreddit);
      if (!sub.ok) return sub;

      const shaped = buildRedditSearchQuery(input.query, sub.value);
      if (!shaped.ok) return shaped;

      const sortBy = input.sortBy ?? "relevance";
      const timeframe = input.timeframe ?? "all";
      const rawLimit = input.limit ?? DEFAULT_SEARCH_LIMIT;
      const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(rawLimit)));

      const found = await deps.gateway.searchPosts({
        query: shaped.value,
        subreddit: sub.value,
        sortBy,
        timeframe,
        limit,
      });
      if (!found.ok) return found;

      return ok({
        queryUsed: shaped.value,
        subreddit: sub.value,
        results: found.value.slice(0, limit),
      });
    },

    async getThread(input: {
      post: string;
      commentSort?: "top" | "best" | "new";
      commentLimit?: number;
      cursor?: number;
      maxBytes?: number;
    }): Promise<Result<GetRedditThreadOutput, RedditError>> {
      const parsedId = parseRedditPostId(input.post);
      if (!parsedId.ok) return parsedId;

      const commentSort = input.commentSort ?? "top";
      const rawLimit = input.commentLimit ?? DEFAULT_COMMENT_LIMIT;
      const commentLimit = Math.max(5, Math.min(MAX_COMMENT_LIMIT, Math.floor(rawLimit)));

      const fetched = await deps.gateway.fetchThread({
        postId: parsedId.value,
        commentSort,
        commentLimit,
      });
      if (!fetched.ok) return fetched;

      const page = formatThreadPage(fetched.value, {
        cursor: input.cursor,
        maxBytes: input.maxBytes,
      });

      return ok({
        postId: fetched.value.postId,
        url: fetched.value.url,
        subreddit: fetched.value.subreddit,
        title: fetched.value.title,
        author: fetched.value.author,
        score: fetched.value.score,
        numComments: fetched.value.numComments,
        createdUtc: fetched.value.createdUtc,
        content: page.text,
        cursor: page.cursor,
        ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
        returnedItems: page.returnedItems,
        totalItems: page.totalItems,
      });
    },
  };
}

export type RedditService = ReturnType<typeof makeReddit>;
