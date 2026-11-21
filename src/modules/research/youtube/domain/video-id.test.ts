import { describe, expect, it } from "vitest";
import { parseYouTubeVideoId, youtubeWatchUrl } from "./video-id";

describe("parseYouTubeVideoId", () => {
  it("accepts a raw 11-character video ID", () => {
    const res = parseYouTubeVideoId("dQw4w9WgXcQ");
    expect(res).toEqual({ ok: true, value: "dQw4w9WgXcQ" });
  });

  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&t=120s",
    "https://m.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc123",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "youtube.com/watch?v=dQw4w9WgXcQ",
  ])("extracts the video ID from %s", (url) => {
    const res = parseYouTubeVideoId(url);
    expect(res).toEqual({ ok: true, value: "dQw4w9WgXcQ" });
  });

  it("builds a canonical watch URL", () => {
    const res = parseYouTubeVideoId("youtu.be/dQw4w9WgXcQ");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(youtubeWatchUrl(res.value)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }
  });

  it.each([
    "",
    "   ",
    "not-a-url",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=short",
  ])("rejects invalid input %j", (bad) => {
    const res = parseYouTubeVideoId(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("InvalidVideoInput");
    }
  });
});
