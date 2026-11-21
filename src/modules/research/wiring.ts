import { pick } from "@/shared/kernel";
import type { RedditService, YoutubeService } from ".";

// The research module's capabilities (ADR 0026): the research tools read Reddit threads and search
// posts, and read YouTube transcripts and search videos.

export function wireRedditCapabilities({ reddit }: Readonly<{ reddit: RedditService }>) {
  return { reddit: pick(reddit, "getThread", "searchPosts") };
}

export function wireYoutubeCapabilities({ youtube }: Readonly<{ youtube: YoutubeService }>) {
  return { youtube: pick(youtube, "getTranscript", "searchDeckTechs") };
}
