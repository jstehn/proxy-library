import { describe, expect, it } from "vitest";
import { buildRedditSearchQuery, DEFAULT_MTG_SUBREDDITS, normalizeSubreddit } from "./search";

describe("normalizeSubreddit", () => {
  it("defaults to MTG subreddits", () => {
    expect(normalizeSubreddit()).toEqual({ ok: true, value: DEFAULT_MTG_SUBREDDITS.join("+") });
    expect(normalizeSubreddit("  ")).toEqual({ ok: true, value: DEFAULT_MTG_SUBREDDITS.join("+") });
  });

  it("strips r/ prefix and trailing slashes", () => {
    expect(normalizeSubreddit("r/EDH/")).toEqual({ ok: true, value: "EDH" });
    expect(normalizeSubreddit("/r/CompetitiveEDH")).toEqual({ ok: true, value: "CompetitiveEDH" });
    expect(normalizeSubreddit("ALL")).toEqual({ ok: true, value: "all" });
  });

  it("rejects invalid subreddit names", () => {
    expect(normalizeSubreddit("EDH?foo=bar").ok).toBe(false);
    expect(normalizeSubreddit("a").ok).toBe(false);
  });
});

describe("buildRedditSearchQuery", () => {
  it("preserves exact queries on MTG subreddits", () => {
    expect(buildRedditSearchQuery("  Henzie   Toolbox Torre ", "EDH")).toEqual({
      ok: true,
      value: "Henzie Toolbox Torre",
    });
  });

  it("appends MTG when searching all of Reddit without MTG terms", () => {
    expect(buildRedditSearchQuery("Henzie Toolbox Torre", "all")).toEqual({
      ok: true,
      value: "Henzie Toolbox Torre MTG",
    });
    expect(buildRedditSearchQuery("Henzie EDH primer", "all")).toEqual({
      ok: true,
      value: "Henzie EDH primer",
    });
  });

  it("rejects empty queries", () => {
    expect(buildRedditSearchQuery("   ", "EDH").ok).toBe(false);
  });
});
