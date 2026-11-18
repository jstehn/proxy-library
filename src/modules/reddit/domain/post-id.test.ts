import { describe, expect, it } from "vitest";
import { parseRedditPostId, redditPostUrl } from "./post-id";

describe("parseRedditPostId", () => {
  it("accepts raw post IDs and fullnames", () => {
    expect(parseRedditPostId("1abc2de")).toEqual({ ok: true, value: "1abc2de" });
    expect(parseRedditPostId("T3_1ABC2DE")).toEqual({ ok: true, value: "1abc2de" });
  });

  it("extracts IDs from standard, old, mobile, and short Reddit URLs", () => {
    const urls = [
      "https://www.reddit.com/r/EDH/comments/1abc2de/henzie_primer/",
      "https://old.reddit.com/r/CompetitiveEDH/comments/1abc2de/",
      "https://reddit.com/comments/1abc2de",
      "https://redd.it/1abc2de",
      "https://m.reddit.com/r/BudgetBrews/comments/1abc2de/budget_list/?utm_source=share",
    ];
    for (const url of urls) {
      expect(parseRedditPostId(url)).toEqual({ ok: true, value: "1abc2de" });
    }
  });

  it("rejects empty or non-Reddit URLs", () => {
    expect(parseRedditPostId("").ok).toBe(false);
    expect(parseRedditPostId("https://example.com/r/EDH/comments/1abc2de/").ok).toBe(false);
    expect(parseRedditPostId("https://www.reddit.com/r/EDH/").ok).toBe(false);
  });

  it("formats canonical URLs", () => {
    const parsed = parseRedditPostId("1abc2de");
    if (!parsed.ok) throw new Error("expected ok");
    expect(redditPostUrl(parsed.value, "EDH")).toBe(
      "https://www.reddit.com/r/EDH/comments/1abc2de/",
    );
    expect(redditPostUrl(parsed.value)).toBe("https://www.reddit.com/comments/1abc2de/");
  });
});
