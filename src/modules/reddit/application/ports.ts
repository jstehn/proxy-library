import type { Result } from "@/shared/kernel";
import type {
  RedditPostId,
  RedditSearchPost,
  RedditSortMode,
  RedditThread,
  RedditTimeframe,
} from "../domain";

export type RedditError =
  | Readonly<{ kind: "InvalidPostInput"; message: string }>
  | Readonly<{ kind: "InvalidSearchQuery"; message: string }>
  | Readonly<{ kind: "PostNotFound"; message: string }>
  | Readonly<{ kind: "RateLimited"; message: string }>
  | Readonly<{ kind: "UpstreamError"; message: string }>;

export type RedditGateway = Readonly<{
  searchPosts(params: {
    query: string;
    subreddit: string;
    sortBy: RedditSortMode;
    timeframe: RedditTimeframe;
    limit: number;
  }): Promise<Result<readonly RedditSearchPost[], RedditError>>;

  fetchThread(params: {
    postId: RedditPostId;
    commentSort: "top" | "best" | "new";
    commentLimit: number;
  }): Promise<Result<RedditThread, RedditError>>;
}>;
