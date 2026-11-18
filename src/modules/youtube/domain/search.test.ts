import { describe, expect, it } from "vitest";
import {
  buildDeckTechQuery,
  parseAgeMonths,
  parseViewCount,
  rankAndFilterSearchResults,
} from "./search";
import type { YouTubeVideoId } from "./video-id";

describe("buildDeckTechQuery", () => {
  it("appends MTG Commander deck tech context for bare commander names", () => {
    expect(buildDeckTechQuery("Henzie Toolbox Torre", "deck_tech")).toEqual({
      ok: true,
      value: "Henzie Toolbox Torre MTG Commander deck tech",
    });
  });

  it("appends guide primer context when kind is 'guide'", () => {
    expect(buildDeckTechQuery("Dimir Mill", "guide")).toEqual({
      ok: true,
      value: "Dimir Mill MTG Commander guide primer",
    });
  });

  it("does not duplicate context when query already mentions MTG/EDH/primer", () => {
    expect(buildDeckTechQuery("Jolene cEDH primer", "deck_tech")).toEqual({
      ok: true,
      value: "Jolene cEDH primer",
    });
  });

  it("passes raw query through when kind is 'any'", () => {
    expect(buildDeckTechQuery("Tolarian Community College", "any")).toEqual({
      ok: true,
      value: "Tolarian Community College",
    });
  });

  it("rejects blank queries", () => {
    const res = buildDeckTechQuery("   ");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("InvalidSearchQuery");
  });
});

describe("parseViewCount & parseAgeMonths", () => {
  it("parses compact view counts", () => {
    expect(parseViewCount("28K")).toBe(28_000);
    expect(parseViewCount("1.3K views")).toBe(1_300);
    expect(parseViewCount("1M")).toBe(1_000_000);
    expect(parseViewCount("1,234")).toBe(1_234);
    expect(parseViewCount(null)).toBeNull();
  });

  it("parses relative age strings into months", () => {
    expect(parseAgeMonths("6mo ago")).toBe(6);
    expect(parseAgeMonths("2y ago")).toBe(24);
    expect(parseAgeMonths("3 weeks ago")).toBeCloseTo(3 / 4.345, 2);
    expect(parseAgeMonths(null)).toBeNull();
  });
});

describe("rankAndFilterSearchResults", () => {
  const mk = (
    id: string,
    channel: string,
    durationSec: number,
    publishedText: string,
    viewCountText: string,
  ) => ({
    videoId: id as YouTubeVideoId,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: `Video ${id}`,
    channel,
    durationSec,
    durationText: `${Math.floor(durationSec / 60)}:00`,
    publishedText,
    viewCountText,
  });

  it("filters out <3m clips for deck_tech, caps per-channel to 2, and balances views + recency", () => {
    const results = [
      mk("short111111", "MaldHound", 89, "2y ago", "149K"),
      mk("daenen11111", "Commander by Daenen", 500, "7mo ago", "2.2K"),
      mk("daenen22222", "Commander by Daenen", 600, "1mo ago", "1.3K"),
      mk("daenen33333", "Commander by Daenen", 600, "1y ago", "3.3K"),
      mk("comedian111", "ComedIan MTG", 1500, "6mo ago", "20K"),
      mk("snail111111", "Salubrious Snail", 752, "2y ago", "1M"),
      mk("old11111111", "Joel Are Magic", 918, "6y ago", "20K"),
    ];

    const ranked = rankAndFilterSearchResults(results, {
      kind: "deck_tech",
      sortBy: "balanced",
      limit: 10,
    });

    // Short (<180s) excluded, Daenen capped at 2, high-view recent/classic rise to top.
    expect(ranked.map((r) => r.videoId)).not.toContain("short111111");
    expect(ranked.filter((r) => r.channel === "Commander by Daenen")).toHaveLength(2);
    expect(ranked[0]?.videoId).toBe("comedian111");
    expect(ranked[1]?.videoId).toBe("snail111111");
    expect(ranked[ranked.length - 1]?.videoId).toBe("old11111111");
  });
});
