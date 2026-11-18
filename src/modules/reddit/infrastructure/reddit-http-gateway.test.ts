import { describe, expect, it, vi } from "vitest";
import type { Clock } from "@/shared/kernel";
import type { RedditPostId } from "../domain";
import { redditHttpGateway } from "./reddit-http-gateway";

const testClock: Clock = { now: () => new Date(1_700_000_000_000) };

describe("redditHttpGateway", () => {
  it("parses search results from Reddit Listing JSON", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        kind: "Listing",
        data: {
          children: [
            {
              kind: "t3",
              data: {
                id: "1abc2de",
                subreddit: "EDH",
                title: "Henzie Blitz Tech",
                author: "blitz_op",
                score: 150,
                num_comments: 32,
                created_utc: 1_700_000_000,
                selftext: "Try Bringer of the Last Gift.",
                permalink: "/r/EDH/comments/1abc2de/henzie_blitz_tech/",
              },
            },
          ],
        },
      }),
    );

    const gateway = redditHttpGateway(testClock, { fetchFn, sleep: async () => {} });
    const res = await gateway.searchPosts({
      query: "Henzie",
      subreddit: "EDH",
      sortBy: "relevance",
      timeframe: "all",
      limit: 5,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0]?.postId).toBe("1abc2de");
    expect(res.value[0]?.url).toBe(
      "https://www.reddit.com/r/EDH/comments/1abc2de/henzie_blitz_tech/",
    );
  });

  it("parses thread + nested comments and caches by postId/sort/limit", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json([
        {
          kind: "Listing",
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "1abc2de",
                  subreddit: "EDH",
                  title: "Henzie Primer",
                  author: "op",
                  score: 80,
                  num_comments: 2,
                  created_utc: 1_700_000_000,
                  selftext: "Main post",
                },
              },
            ],
          },
        },
        {
          kind: "Listing",
          data: {
            children: [
              {
                kind: "t1",
                data: {
                  id: "c1",
                  author: "a1",
                  score: 12,
                  body: "Top reply",
                  created_utc: 1_700_000_010,
                  replies: {
                    kind: "Listing",
                    data: {
                      children: [
                        {
                          kind: "t1",
                          data: {
                            id: "c2",
                            author: "a2",
                            score: 5,
                            body: "Nested reply",
                            created_utc: 1_700_000_020,
                            replies: "",
                          },
                        },
                      ],
                    },
                  },
                },
              },
              {
                kind: "t1",
                data: { id: "c3", author: "[deleted]", score: 0, body: "[deleted]" },
              },
            ],
          },
        },
      ]),
    );

    const gateway = redditHttpGateway(testClock, { fetchFn, sleep: async () => {} });
    const first = await gateway.fetchThread({
      postId: "1abc2de" as RedditPostId,
      commentSort: "top",
      commentLimit: 40,
    });
    const second = await gateway.fetchThread({
      postId: "1abc2de" as RedditPostId,
      commentSort: "top",
      commentLimit: 40,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    if (!first.ok) return;
    expect(first.value.comments).toHaveLength(2);
    expect(first.value.comments[0]?.depth).toBe(0);
    expect(first.value.comments[1]?.depth).toBe(1);
  });

  it("maps 404 to PostNotFound and 429 to RateLimited", async () => {
    const notFoundFetch = vi.fn(async () => new Response("Not Found", { status: 404 }));
    const gw404 = redditHttpGateway(testClock, { fetchFn: notFoundFetch, sleep: async () => {} });
    const r404 = await gw404.fetchThread({
      postId: "missing1" as RedditPostId,
      commentSort: "top",
      commentLimit: 20,
    });
    expect(r404.ok).toBe(false);
    if (!r404.ok) expect(r404.error.kind).toBe("PostNotFound");

    const rateFetch = vi.fn(async () => new Response("Too Many Requests", { status: 429 }));
    const gw429 = redditHttpGateway(testClock, { fetchFn: rateFetch, sleep: async () => {} });
    const r429 = await gw429.searchPosts({
      query: "Henzie",
      subreddit: "EDH",
      sortBy: "relevance",
      timeframe: "all",
      limit: 5,
    });
    expect(r429.ok).toBe(false);
    if (!r429.ok) expect(r429.error.kind).toBe("RateLimited");
  });

  it("uses OAuth2 client_credentials when clientId and clientSecret are provided", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/access_token")) {
        return Response.json({ access_token: "tok_123", expires_in: 3600 });
      }
      expect(url).toContain("https://oauth.reddit.com/r/EDH/search");
      const auth = new Headers(init?.headers).get("Authorization");
      expect(auth).toBe("Bearer tok_123");
      return Response.json({ kind: "Listing", data: { children: [] } });
    });

    const gw = redditHttpGateway(testClock, {
      fetchFn,
      sleep: async () => {},
      clientId: "cid",
      clientSecret: "csec",
    });
    const res = await gw.searchPosts({
      query: "Henzie",
      subreddit: "EDH",
      sortBy: "relevance",
      timeframe: "all",
      limit: 5,
    });
    expect(res.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
