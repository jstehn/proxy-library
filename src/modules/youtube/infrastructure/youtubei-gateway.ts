import { Innertube, Log } from "youtubei.js";
import { fetchTranscript as fetchYoutubeTranscript } from "youtube-transcript-plus";
import { err, ok, type Clock, type Result } from "@/shared/kernel";
import type { YouTubeError, YouTubeGateway } from "../application";
import {
  parseYouTubeVideoId,
  youtubeWatchUrl,
  type TranscriptSegment,
  type VideoTranscript,
  type YouTubeSearchResult,
  type YouTubeVideoId,
} from "../domain";

const TRANSCRIPT_CACHE_TTL_MS = 20 * 60 * 1000;
const TRANSCRIPT_CACHE_MAX_ENTRIES = 50;

type CacheEntry = Readonly<{
  transcript: VideoTranscript;
  expiresAtMs: number;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readText(value: unknown): string | null {
  if (typeof value === "string") return value;
  const rec = asRecord(value);
  if (!rec) return null;
  if (typeof rec.text === "string") return rec.text;
  if (typeof rec.toString === "function" && rec.toString !== Object.prototype.toString) {
    const str = String(rec);
    return str === "[object Object]" ? null : str;
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function classifyYouTubeError(error: unknown, fallbackMessage: string): YouTubeError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("429") || lower.includes("too many requests") || lower.includes("captcha")) {
    return {
      kind: "RateLimited",
      message: "YouTube rate-limited the request. Wait a moment and try again.",
    };
  }
  if (
    lower.includes("unavailable") ||
    lower.includes("not found") ||
    lower.includes("private") ||
    lower.includes("404")
  ) {
    return {
      kind: "VideoNotFound",
      message: "The YouTube video was not found or is unavailable/private.",
    };
  }
  if (
    lower.includes("transcript") ||
    lower.includes("caption") ||
    lower.includes("subtitles") ||
    lower.includes("disabled")
  ) {
    return {
      kind: "TranscriptUnavailable",
      message: "No captions or transcript are available for this video.",
    };
  }

  return {
    kind: "UpstreamError",
    message: `${fallbackMessage}: ${message}`,
  };
}

function mapSearchItem(raw: unknown): YouTubeSearchResult | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const rawId = typeof rec.id === "string" ? rec.id : null;
  if (!rawId) return null;

  const parsedId = parseYouTubeVideoId(rawId);
  if (!parsedId.ok) return null;

  const title = readText(rec.title);
  if (!title) return null;

  const author = asRecord(rec.author);
  const channel = readText(author?.name) ?? "Unknown channel";

  const duration = asRecord(rec.duration);
  const durationSec = readNumber(duration?.seconds);
  const durationText = readText(duration?.text);
  const publishedText = readText(rec.published);
  const viewCountText = readText(rec.short_view_count) ?? readText(rec.view_count);

  return {
    videoId: parsedId.value,
    url: youtubeWatchUrl(parsedId.value),
    title,
    channel,
    durationSec,
    durationText,
    publishedText,
    viewCountText,
  };
}

/**
 * Anti-corruption layer over `youtubei.js` (search + metadata) and `youtube-transcript-plus`
 * (transcripts) per ADR 0007, with a bounded in-memory TTL cache for transcripts so `cursor`
 * pagination across long deck-tech videos does not re-fetch YouTube.
 */
export function youtubeiGateway(clock: Clock): YouTubeGateway {
  Log.setLevel(Log.Level.NONE);
  let clientPromise: Promise<Innertube> | null = null;
  const cache = new Map<string, CacheEntry>();

  function getClient(): Promise<Innertube> {
    if (!clientPromise) {
      clientPromise = Innertube.create({ lang: "en", location: "US" }).catch((error) => {
        clientPromise = null;
        throw error;
      });
    }
    return clientPromise;
  }

  function getCached(key: string): VideoTranscript | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (clock.now().getTime() >= entry.expiresAtMs) {
      cache.delete(key);
      return null;
    }
    // Refresh insertion order for LRU eviction.
    cache.delete(key);
    cache.set(key, entry);
    return entry.transcript;
  }

  function setCached(key: string, transcript: VideoTranscript): void {
    if (cache.size >= TRANSCRIPT_CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(key, {
      transcript,
      expiresAtMs: clock.now().getTime() + TRANSCRIPT_CACHE_TTL_MS,
    });
  }

  return {
    async searchVideos({ query, limit }) {
      try {
        const yt = await getClient();
        const search = await yt.search(query, { type: "video" });
        const rawVideos = Array.isArray(search.videos) ? search.videos : [];
        const results: YouTubeSearchResult[] = [];

        for (const item of rawVideos) {
          const mapped = mapSearchItem(item);
          if (mapped) {
            results.push(mapped);
            if (results.length >= limit) break;
          }
        }

        return ok(results);
      } catch (error) {
        return err(classifyYouTubeError(error, "Failed to search YouTube videos"));
      }
    },

    async fetchTranscript({
      videoId,
      lang,
    }: {
      videoId: YouTubeVideoId;
      lang: string;
    }): Promise<Result<VideoTranscript, YouTubeError>> {
      const cacheKey = `${videoId}:${lang}`;
      const cached = getCached(cacheKey);
      if (cached) return ok(cached);

      try {
        const yt = await getClient();

        // Fetch metadata and transcript in parallel; metadata is best-effort so a parser quirk
        // never blocks a valid transcript.
        const [infoResult, rawSegments] = await Promise.all([
          yt.getBasicInfo(videoId).catch(() => null),
          fetchYoutubeTranscript(videoId, { lang }).catch((error) => {
            if (lang) {
              return fetchYoutubeTranscript(videoId).catch(() => {
                throw error;
              });
            }
            throw error;
          }),
        ]);

        const basic = asRecord(infoResult?.basic_info);
        const title = readText(basic?.title) ?? `YouTube Video (${videoId})`;
        const channel =
          readText(asRecord(basic?.channel)?.name) ?? readText(basic?.author) ?? "Unknown channel";
        const durationSec = readNumber(basic?.duration);

        const segments: TranscriptSegment[] = rawSegments
          .filter((seg) => typeof seg.text === "string" && seg.text.trim().length > 0)
          .map((seg) => ({
            text: seg.text,
            startSec: Math.max(0, Number.isFinite(seg.offset) ? seg.offset : 0),
            durationSec: Math.max(0, Number.isFinite(seg.duration) ? seg.duration : 0),
          }));

        if (segments.length === 0) {
          return err({
            kind: "TranscriptUnavailable",
            message: "No captions or transcript segments were found for this video.",
          });
        }

        const detectedLang = rawSegments[0]?.lang ?? lang;
        const captionTracks = asRecord(infoResult?.captions)?.caption_tracks;
        const matchingTrack = Array.isArray(captionTracks)
          ? captionTracks.map(asRecord).find((t) => readText(t?.language_code) === detectedLang)
          : null;
        const isAutoGenerated =
          matchingTrack?.kind === "asr" ||
          (readText(matchingTrack?.name)?.toLowerCase().includes("auto-generated") ?? false);

        const result: VideoTranscript = {
          videoId,
          url: youtubeWatchUrl(videoId),
          title,
          channel,
          durationSec,
          language: detectedLang,
          isAutoGenerated,
          segments,
        };

        setCached(cacheKey, result);
        return ok(result);
      } catch (error) {
        return err(classifyYouTubeError(error, "Failed to fetch YouTube transcript"));
      }
    },
  };
}
