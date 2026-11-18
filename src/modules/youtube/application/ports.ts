import type { Result } from "@/shared/kernel";
import type { VideoTranscript, YouTubeSearchResult, YouTubeVideoId } from "../domain";

export type YouTubeError =
  | Readonly<{ kind: "InvalidVideoInput"; message: string }>
  | Readonly<{ kind: "InvalidSearchQuery"; message: string }>
  | Readonly<{ kind: "VideoNotFound"; message: string }>
  | Readonly<{ kind: "TranscriptUnavailable"; message: string }>
  | Readonly<{ kind: "RateLimited"; message: string }>
  | Readonly<{ kind: "UpstreamError"; message: string }>;

export type YouTubeGateway = Readonly<{
  searchVideos(params: {
    query: string;
    limit: number;
  }): Promise<Result<readonly YouTubeSearchResult[], YouTubeError>>;

  fetchTranscript(params: {
    videoId: YouTubeVideoId;
    lang: string;
  }): Promise<Result<VideoTranscript, YouTubeError>>;
}>;
