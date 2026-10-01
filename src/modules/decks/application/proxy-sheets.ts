import {
  cardsToPrint,
  proxyImageKey,
  proxyPages,
  type ProxyLine,
  type ProxyOptions,
} from "../domain/proxy-sheet";
import type { ProxySheetsDependencies } from "./ports";

// Proxy PDFs (design doc 14, section 3): lay the deck out, fetch each image once, draw the PDF.

/** How many images are fetched at the same time (most come from the disk cache). */
const IMAGES_AT_ONCE = 6;

export function makeProxySheets(dependencies: ProxySheetsDependencies) {
  const { images, renderer } = dependencies;

  /** The deck's proxies as a PDF. Cards without an image are drawn as a labelled box. */
  async function proxySheet(
    lines: readonly ProxyLine[],
    options: ProxyOptions,
  ): Promise<Uint8Array> {
    const pages = proxyPages(cardsToPrint(lines, options), options);
    // Four Lightning Bolts share one image: fetch each printing's face once.
    const wanted = new Map(
      pages.flatMap((page) =>
        page.placements.map((placement) => [proxyImageKey(placement), placement] as const),
      ),
    );
    const fetched = new Map<string, Uint8Array>();
    const queue = [...wanted.entries()];
    async function worker() {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const [key, placement] = next;
        const bytes = await images.image(placement.printingId, placement.face);
        if (bytes !== null) fetched.set(key, bytes);
      }
    }
    await Promise.all(Array.from({ length: IMAGES_AT_ONCE }, worker));
    return renderer.render(pages, fetched);
  }

  return proxySheet;
}

export type ProxySheet = ReturnType<typeof makeProxySheets>;
