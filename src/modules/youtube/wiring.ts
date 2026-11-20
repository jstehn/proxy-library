import { pick } from "@/shared/kernel";
import type { YoutubeService } from "./application";

// The youtube module's capability (ADR 0026): the research tool reads transcripts and searches.

export function wireYoutubeCapabilities({ youtube }: Readonly<{ youtube: YoutubeService }>) {
  return { youtube: pick(youtube, "getTranscript", "searchDeckTechs") };
}
