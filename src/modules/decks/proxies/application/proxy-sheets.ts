import {
  proxyImageKey,
  proxyPages,
  type ProxyLine,
  type ProxyOptions,
} from "../domain/proxy-sheet";
import type { ProxyProgress } from "../domain/proxy-progress";
import { sheetCards, type TokenLine } from "../domain/token-proxies";
import type { ProxySheetsDependencies } from "./ports";

// Proxy PDFs (design doc 14, section 3): lay the deck out, fetch each image once, draw the PDF.
// The playtest style (design doc 22) fetches each card's art crop instead of its scan, and none
// at all when the art is turned off. The deck's tokens follow its cards (design doc 25).

/** What one PDF prints: the deck's lines and the tokens its cards make. */
export type ProxySheetInput = Readonly<{
  lines: readonly ProxyLine[];
  tokens: readonly TokenLine[];
}>;

/** How many images are fetched at the same time (most come from the disk cache). */
const IMAGES_AT_ONCE = 6;

export function makeProxySheets(dependencies: ProxySheetsDependencies) {
  const { images, renderer } = dependencies;

  /** The deck's proxies (and its tokens) as a PDF. Cards without a scan are drawn as a labelled box. */
  async function proxySheet(
    input: ProxySheetInput,
    options: ProxyOptions,
    onProgress: (progress: ProxyProgress) => void = () => undefined,
  ): Promise<Uint8Array> {
    const pages = proxyPages(sheetCards(input.lines, input.tokens, options), options);
    // Four Lightning Bolts share one image: fetch each printing's face once.
    const playtest = options.style === "playtest";
    const needsImages = !playtest || options.artFilter !== "none";
    const wanted = new Map(
      pages.flatMap((page) =>
        needsImages
          ? page.placements.map((placement) => [proxyImageKey(placement), placement] as const)
          : [],
      ),
    );
    const fetched = new Map<string, Uint8Array>();
    const queue = [...wanted.entries()];
    let done = 0;
    onProgress({ stage: "images", done, total: wanted.size });
    async function worker() {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const [key, placement] = next;
        const bytes = playtest
          ? await images.artCrop(placement.printingId, placement.face)
          : await images.image(placement.printingId, placement.face);
        if (bytes !== null) fetched.set(key, bytes);
        done++;
        onProgress({ stage: "images", done, total: wanted.size });
      }
    }
    await Promise.all(Array.from({ length: IMAGES_AT_ONCE }, worker));
    return renderer.render(pages, fetched, options, onProgress);
  }

  return proxySheet;
}

export type ProxySheet = ReturnType<typeof makeProxySheets>;
