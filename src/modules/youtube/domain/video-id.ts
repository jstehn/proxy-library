import { err, ok, type Brand, type Result } from "@/shared/kernel";

export type YouTubeVideoId = Brand<string, "YouTubeVideoId">;

export type ParseVideoIdError = Readonly<{
  kind: "InvalidVideoInput";
  message: string;
}>;

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/**
 * Extracts and validates an 11-character YouTube video ID from a raw ID or any standard
 * YouTube URL (`watch?v=`, `youtu.be/`, `shorts/`, `live/`, `embed/`, `v/`).
 */
export function parseYouTubeVideoId(input: string): Result<YouTubeVideoId, ParseVideoIdError> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return err({
      kind: "InvalidVideoInput",
      message: "Provide a YouTube video URL or 11-character video ID.",
    });
  }

  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return ok(trimmed as YouTubeVideoId);
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return err({
      kind: "InvalidVideoInput",
      message: `Could not parse "${trimmed}" as a YouTube video URL or 11-character ID.`,
    });
  }

  const host = url.hostname.toLowerCase();
  let candidate: string | null = null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const vParam = url.searchParams.get("v");
    if (vParam !== null) {
      candidate = vParam;
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (
        parts.length >= 2 &&
        (parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed" || parts[0] === "v")
      ) {
        candidate = parts[1] ?? null;
      }
    }
  }

  if (candidate !== null && VIDEO_ID_PATTERN.test(candidate)) {
    return ok(candidate as YouTubeVideoId);
  }

  return err({
    kind: "InvalidVideoInput",
    message: `Could not extract a valid 11-character YouTube video ID from "${trimmed}".`,
  });
}

export function youtubeWatchUrl(videoId: YouTubeVideoId): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
