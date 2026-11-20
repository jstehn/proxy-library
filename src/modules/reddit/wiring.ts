import { pick } from "@/shared/kernel";
import type { RedditService } from "./application";

// The reddit module's capability (ADR 0026): the research tool reads threads and searches posts.

export function wireRedditCapabilities({ reddit }: Readonly<{ reddit: RedditService }>) {
  return { reddit: pick(reddit, "getThread", "searchPosts") };
}
