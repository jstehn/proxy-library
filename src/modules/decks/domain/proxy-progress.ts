// Progress while a proxy PDF is made (design doc 22, section 16): the server reports each image
// fetched and each page drawn as one line of JSON, the PDF comes last, and the browser shows a
// bar. Pure, and safe for the browser (it's in client.ts).

/** How far along the PDF is: fetching images, drawing pages, then saving the file. */
export type ProxyProgress = Readonly<{
  stage: "images" | "pages" | "saving";
  done: number;
  total: number;
}>;

/** One line of the progress stream. The PDF is base64, since the stream is text. */
export type ProxyStreamEvent =
  | Readonly<{ kind: "progress"; progress: ProxyProgress }>
  | Readonly<{ kind: "pdf"; fileName: string; base64: string }>
  | Readonly<{ kind: "error"; message: string }>;

// Images take the longest (each may be downloaded from Scryfall the first time), then pages.
const STAGE_SHARES = { images: [0, 0.65], pages: [0.65, 0.97], saving: [0.97, 1] } as const;

/** The share of the work done, from 0 to 1, for a progress bar. */
export function progressFraction(progress: ProxyProgress): number {
  const [start, end] = STAGE_SHARES[progress.stage];
  const within = progress.total === 0 ? 1 : Math.min(1, progress.done / progress.total);
  return start + (end - start) * within;
}

/** What's happening, in words: "Card images: 12 of 75". */
export function progressLabel(progress: ProxyProgress): string {
  if (progress.stage === "saving") return "Saving the PDF";
  const noun = progress.stage === "images" ? "Card images" : "Drawing pages";
  return `${noun}: ${progress.done} of ${progress.total}`;
}

/**
 * Splits streamed text into complete lines. A chunk can end halfway through a line, so the
 * unfinished end is handed back to be joined to the next chunk.
 */
export function completeLines(pending: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (pending + chunk).split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((line) => line !== ""), rest };
}
