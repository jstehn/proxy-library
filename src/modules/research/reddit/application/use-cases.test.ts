import { describe, expect, it } from "vitest";
import { err, ok } from "@/shared/kernel";
import type { RedditPostId } from "../domain";
import type { RedditGateway } from "./ports";
import { makeReddit } from "./use-cases";

function fakeGateway(): RedditGateway {
  return {
    async searchPosts({ limit }) {
      return ok(
        Array.from({ length: limit }, (_, i) => ({
          postId: `1abc0${i}` as RedditPostId,
          url: `https://www.reddit.com/r/EDH/comments/1abc0${i}/`,
          subreddit: "EDH",
          title: `Henzie thread ${i}`,
          author: "player1",
          score: 42 - i,
          numComments: 12,
          createdUtc: 1_700_000_000,
          selftextSnippet: "Blitz value...",
        })),
      );
    },
    async fetchThread({ postId }) {
      if (postId === ("missing0" as RedditPostId)) {
        return err({ kind: "PostNotFound", message: "Not found" });
      }
      return ok({
        postId,
        url: `https://www.reddit.com/r/EDH/comments/${postId}/`,
        subreddit: "EDH",
        title: "Henzie Primer",
        author: "blitz_op",
        score: 99,
        numComments: 2,
        createdUtc: 1_700_000_000,
        selftext: "Run [[Bringer of the Last Gift]].",
        comments: [
          {
            id: "c1",
            author: "commenter1",
            score: 25,
            depth: 0,
            body: "Industrial Advancement is great too.",
            createdUtc: 1_700_000_100,
          },
          {
            id: "c2",
            author: "commenter2",
            score: 10,
            depth: 1,
            body: "Agreed, instant speed sac.",
            createdUtc: 1_700_000_200,
          },
        ],
      });
    },
  };
}

describe("makeReddit use cases", () => {
  it("searches posts with default MTG subreddits and clamped limit", async () => {
    const service = makeReddit({ gateway: fakeGateway() });
    const result = await service.searchPosts({ query: "Henzie", limit: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.subreddit).toBe("EDH+CompetitiveEDH+BudgetBrews+magicTCG");
    expect(result.value.results).toHaveLength(3);
  });

  it("rejects invalid subreddit or empty query", async () => {
    const service = makeReddit({ gateway: fakeGateway() });
    const badSub = await service.searchPosts({ query: "Henzie", subreddit: "r/a" });
    expect(badSub.ok).toBe(false);
    const badQuery = await service.searchPosts({ query: "   " });
    expect(badQuery.ok).toBe(false);
  });

  it("fetches and formats a thread from a Reddit URL", async () => {
    const service = makeReddit({ gateway: fakeGateway() });
    const result = await service.getThread({
      post: "https://www.reddit.com/r/EDH/comments/1abc2de/henzie_primer/",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.postId).toBe("1abc2de");
    expect(result.value.content).toContain("Bringer of the Last Gift");
    expect(result.value.content).toContain("Industrial Advancement");
    expect(result.value.totalItems).toBe(3);
  });

  it("maps PostNotFound from gateway", async () => {
    const service = makeReddit({ gateway: fakeGateway() });
    const result = await service.getThread({ post: "missing0" });
    expect(result).toEqual({
      ok: false,
      error: { kind: "PostNotFound", message: "Not found" },
    });
  });
});
