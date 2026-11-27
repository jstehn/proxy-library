import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clock } from "@/shared/kernel";
import type { YouTubeVideoId } from "../domain";

const { innertubeCreateMock, fetchYoutubeTranscriptMock } = vi.hoisted(() => ({
  innertubeCreateMock: vi.fn(),
  fetchYoutubeTranscriptMock: vi.fn(),
}));

vi.mock("youtubei.js", () => ({
  Innertube: { create: innertubeCreateMock },
  Log: { setLevel: vi.fn(), Level: { NONE: 0 } },
}));

vi.mock("youtube-transcript-plus", () => ({
  fetchTranscript: fetchYoutubeTranscriptMock,
}));

import { youtubeiGateway } from "./youtubei-gateway";

describe("youtubeiGateway", () => {
  beforeEach(() => {
    innertubeCreateMock.mockReset();
    fetchYoutubeTranscriptMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches searchVideos for 5 minutes with normalized query keys and does not cache errors", async () => {
    let nowMs = 1_700_000_000_000;
    const clock: Clock = { now: () => new Date(nowMs) };
    const searchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary 503"))
      .mockResolvedValue({
        videos: [
          {
            id: "dQw4w9WgXcQ",
            title: "Henzie Deck Tech",
            author: { name: "Commander TV" },
            duration: { seconds: 600, text: "10:00" },
          },
        ],
      });
    innertubeCreateMock.mockResolvedValue({ search: searchMock });

    const gateway = youtubeiGateway(clock);
    const errRes = await gateway.searchVideos({ query: "  Henzie  Tech ", limit: 5 });
    expect(errRes.ok).toBe(false);
    expect(searchMock).toHaveBeenCalledTimes(1);

    const firstOk = await gateway.searchVideos({ query: "  Henzie  Tech ", limit: 5 });
    expect(firstOk.ok).toBe(true);
    expect(searchMock).toHaveBeenCalledTimes(2);

    const cachedOk = await gateway.searchVideos({ query: "henzie tech", limit: 5 });
    expect(cachedOk.ok).toBe(true);
    expect(searchMock).toHaveBeenCalledTimes(2);

    nowMs += 5 * 60 * 1000;
    const expiredOk = await gateway.searchVideos({ query: "henzie tech", limit: 5 });
    expect(expiredOk.ok).toBe(true);
    expect(searchMock).toHaveBeenCalledTimes(3);
  });

  it("times out searchVideos after 12_000 ms as UpstreamError", async () => {
    vi.useFakeTimers();
    const clock: Clock = { now: () => new Date(1_700_000_000_000) };
    innertubeCreateMock.mockResolvedValue({
      search: vi.fn(() => new Promise(() => {})),
    });

    const gateway = youtubeiGateway(clock);
    const pending = gateway.searchVideos({ query: "henzie", limit: 5 });
    await vi.advanceTimersByTimeAsync(12_000);

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("UpstreamError");
      expect(result.error.message).toContain("timed out");
    }
  });

  it("starts transcript fetch concurrently without waiting on Innertube.create and uses fallback metadata if metadata times out", async () => {
    vi.useFakeTimers();
    const clock: Clock = { now: () => new Date(1_700_000_000_000) };

    // Innertube.create hangs past the 6_000 ms metadata timeout.
    innertubeCreateMock.mockImplementation(() => new Promise(() => {}));
    fetchYoutubeTranscriptMock.mockResolvedValue([
      { text: "Welcome to Henzie.", offset: 0, duration: 4, lang: "en" },
    ]);

    const gateway = youtubeiGateway(clock);
    const pending = gateway.fetchTranscript({
      videoId: "dQw4w9WgXcQ" as YouTubeVideoId,
      lang: "en",
    });

    // fetchYoutubeTranscript was invoked immediately without waiting for Innertube.create.
    expect(fetchYoutubeTranscriptMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6_000);
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("YouTube Video (dQw4w9WgXcQ)");
      expect(result.value.segments).toHaveLength(1);
    }
  });

  it("classifies a 12_000 ms transcript timeout as UpstreamError rather than TranscriptUnavailable", async () => {
    vi.useFakeTimers();
    const clock: Clock = { now: () => new Date(1_700_000_000_000) };
    innertubeCreateMock.mockResolvedValue({
      getBasicInfo: vi.fn().mockResolvedValue(null),
    });
    fetchYoutubeTranscriptMock.mockImplementation(() => new Promise(() => {}));

    const gateway = youtubeiGateway(clock);
    const pending = gateway.fetchTranscript({
      videoId: "dQw4w9WgXcQ" as YouTubeVideoId,
      lang: "en",
    });

    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("UpstreamError");
      expect(result.error.message).toContain("timed out");
    }
  });
});
