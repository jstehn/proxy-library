import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage } from "pdf-lib";
import type { ProxyPdfRenderer } from "../application/ports";
import { proxyImageKey, type Placement } from "../domain/proxy-sheet";

// Draws proxy pages with pdf-lib (design doc 14, decision 5). The layout is already decided
// (domain/proxy-sheet.ts); this only paints it: guides first, then the cards on top.

const GUIDE_THICKNESS = 0.5; // points: thin enough to cut along precisely
const GUIDE_COLOR = rgb(0, 0, 0);
const MISSING_FILL = rgb(0.92, 0.92, 0.92);

/** A name the standard PDF font can draw: accents kept where it can, anything else dropped. */
function drawable(font: PDFFont, text: string): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    const plain = text.normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
    return plain === "" ? "?" : plain;
  }
}

export function pdfLibRenderer(): ProxyPdfRenderer {
  async function render(
    pages: Parameters<ProxyPdfRenderer["render"]>[0],
    images: ReadonlyMap<string, Uint8Array>,
  ): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    document.setTitle("Proxies");
    document.setCreator("Proxy Library");
    const font = await document.embedFont(StandardFonts.Helvetica);

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
      for (const guide of page.guides) {
        pdfPage.drawLine({
          start: guide.from,
          end: guide.to,
          thickness: GUIDE_THICKNESS,
          color: GUIDE_COLOR,
        });
      }
      for (const placement of page.placements) {
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
        if (placement.image.width > placement.card.width) {
          // Bleed: the card's image stretched over the bleed area, then the card itself exactly
          // on top. What shows around the card is its own border, a little enlarged.
          pdfPage.drawImage(image, placement.image);
        }
        pdfPage.drawImage(image, placement.card);
      }
    }
    return document.save();
  }

  return { render };
}
