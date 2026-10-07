import { PDFDocument, rgb, StandardFonts, type PDFImage } from "pdf-lib";
import type { ProxyPdfRenderer } from "../application/ports";
import { playtestCard } from "../domain/playtest-card";
import { proxyImageKey, type Placement } from "../domain/proxy-sheet";
import { drawable, makePlaytestPainter, readManaFont } from "./playtest-painter";

// Draws proxy pages with pdf-lib (design doc 14, decision 5). The layout is already decided
// (domain/proxy-sheet.ts); this only paints it: the cards, then the guides on top. Each card is
// its scan, or for the playtest style (design doc 22) a card drawn from its text.

const GUIDE_THICKNESS = 0.5; // points: thin enough to cut along precisely
const GUIDE_COLOR = rgb(0.5, 0.5, 0.5); // mid grey
const MISSING_FILL = rgb(0.92, 0.92, 0.92);

export type PdfLibRendererDependencies = {
  /** The Mana symbol font's bytes (default: from the installed `mana-font` package). */
  manaFont?: () => Promise<Uint8Array>;
};

export function pdfLibRenderer(dependencies: PdfLibRendererDependencies = {}): ProxyPdfRenderer {
  const { manaFont = readManaFont } = dependencies;

  async function render(
    pages: Parameters<ProxyPdfRenderer["render"]>[0],
    images: ReadonlyMap<string, Uint8Array>,
    options: Parameters<ProxyPdfRenderer["render"]>[2],
  ): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    document.setTitle("Proxies");
    document.setCreator("Proxy Library");
    const font = await document.embedFont(StandardFonts.Helvetica);
    const painter =
      options.style === "playtest"
        ? await makePlaytestPainter(document, await manaFont(), options.artFilter)
        : null;

    // Each image is embedded once and drawn as often as needed (four Bolts, one copy in the file).
    const embedded = new Map<string, PDFImage | null>();
    async function imageFor(placement: Placement): Promise<PDFImage | null> {
      const key = proxyImageKey(placement);
      if (!embedded.has(key)) {
        const bytes = images.get(key);
        // A damaged file shouldn't stop the whole sheet: that card gets a labelled box instead.
        const image = bytes === undefined ? null : await document.embedJpg(bytes).catch(() => null);
        embedded.set(key, image);
      }
      return embedded.get(key) ?? null;
    }

    for (const page of pages) {
      const pdfPage = document.addPage([page.width, page.height]);
      for (const placement of page.placements) {
        if (painter !== null) {
          const drawing = playtestCard(
            placement.printed,
            placement.face,
            placement.card,
            { art: options.artFilter !== "none", stripes: options.stripes === "on" },
            painter.measure,
            placement.image,
          );
          const key = proxyImageKey(placement);
          await painter.paint(pdfPage, drawing, images.get(key) ?? null, key);
          continue;
        }
        const image = await imageFor(placement);
        if (image === null) {
          const { card } = placement;
          pdfPage.drawRectangle({ ...card, color: MISSING_FILL });
          pdfPage.drawText(drawable(font, placement.name), {
            x: card.x + 10,
            y: card.y + card.height - 24,
            size: 11,
            font,
            maxWidth: card.width - 20,
            lineHeight: 13,
          });
          continue;
        }
        if (
          placement.image.width > placement.card.width ||
          placement.image.height > placement.card.height
        ) {
          // Bleed: the card's image stretched over the bleed area, then the card itself exactly
          // on top. What shows around the card is its own border, a little enlarged.
          pdfPage.drawImage(image, placement.image);
        }
        pdfPage.drawImage(image, placement.card);
      }
      // Guides last, on top: grey, so where they cross the bleed they're easy to see but don't
      // stand out; they never cross a card's face (domain/proxy-sheet.ts).
      for (const guide of page.guides) {
        pdfPage.drawLine({
          start: guide.from,
          end: guide.to,
          thickness: GUIDE_THICKNESS,
          color: GUIDE_COLOR,
        });
      }
    }
    return document.save();
  }

  return { render };
}
