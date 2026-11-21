import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RedditPostId } from "./post-id";
import { cleanRedditText, formatThreadPage, type RedditThread } from "./thread";

function makeThread(commentCount: number, bodySize = 80): RedditThread {
  return {
    postId: "1abc2de" as RedditPostId,
    url: "https://www.reddit.com/r/EDH/comments/1abc2de/",
    subreddit: "EDH",
    title: "Henzie Toolbox Torre Primer",
    author: "blitz_enjoyer",
    score: 120,
    numComments: commentCount,
    createdUtc: 1_700_000_000,
    selftext: "Opening post about Henzie &amp; blitz.",
    comments: Array.from({ length: commentCount }, (_, i) => ({
      id: `c${i}`,
      author: `user${i}`,
      score: 50 - i,
      depth: i % 3,
      body: `Comment ${i}: ${"x".repeat(bodySize)}`,
      createdUtc: 1_700_000_100 + i,
    })),
  };
}

describe("cleanRedditText", () => {
  it("decodes HTML entities and collapses excessive newlines", () => {
    expect(cleanRedditText("A &amp; B &lt;3\r\n\r\n\r\nC")).toBe("A & B <3\n\nC");
  });
});

describe("formatThreadPage", () => {
  it("includes OP at cursor 0 and paginates comments within maxBytes", () => {
    const thread = makeThread(10, 120);
    const pages: string[] = [];
    let cursor: number | undefined = 0;

    while (cursor !== undefined) {
      const page = formatThreadPage(thread, { cursor, maxBytes: 450 });
      pages.push(page.text);
      cursor = page.nextCursor;
    }

    expect(pages.length).toBeGreaterThan(1);
    const joined = pages.join("\n\n---\n\n");
    expect(joined).toContain("[OP u/blitz_enjoyer | +120]");
    expect(joined).toContain("Henzie & blitz");
    for (let i = 0; i < 10; i++) {
      expect(joined).toContain(`Comment ${i}:`);
    }
  });

  it("property: paging from 0 to undefined visits every non-empty item without gaps", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 25 }),
        fc.integer({ min: 180, max: 900 }),
        (n, maxBytes) => {
          const thread = makeThread(n, 40);
          let cursor: number | undefined = 0;
          let totalReturned = 0;
          let steps = 0;

          while (cursor !== undefined) {
            const page = formatThreadPage(thread, { cursor, maxBytes });
            totalReturned += page.returnedItems;
            cursor = page.nextCursor;
            steps += 1;
            if (steps > n + 2) throw new Error("Infinite pagination loop");
          }

          expect(totalReturned).toBe(1 + n);
        },
      ),
    );
  });
});
