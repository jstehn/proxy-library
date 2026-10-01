import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makeProxySheets } from "../application/proxy-sheets";
import { DEFAULT_PROXY_OPTIONS, type ProxyLine, type ProxyOptions } from "../domain/proxy-sheet";
import { fakeProxyImages } from "../testing/fakes";
import { pdfLibRenderer } from "./pdf-lib-renderer";

const line = (printingId: string, quantity: number, hasBack = false): ProxyLine => ({
  printingId,
  name: printingId,
  quantity,
  board: "main",
  isBasicLand: false,
  hasBack,
  isFoil: false,
});

async function pdfFor(lines: readonly ProxyLine[], options: Partial<ProxyOptions> = {}) {
  const { images } = fakeProxyImages(["delver"]);
  const proxySheet = makeProxySheets({ images, renderer: pdfLibRenderer() });
  const bytes = await proxySheet(lines, { ...DEFAULT_PROXY_OPTIONS, ...options });
  return PDFDocument.load(bytes);
}

describe("pdfLibRenderer", () => {
  it("makes a real PDF: Letter pages, nine cards each, then double-faced fronts and backs", async () => {
    const pdf = await pdfFor([line("bolt", 10), line("delver", 1, true)]);
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    // One embedded image per printing and face, however many copies are drawn.
    const images = pdf.context
      .enumerateIndirectObjects()
      .filter(([, object]) => object.toString().includes("/Subtype /Image"));
    expect(images).toHaveLength(3);
  });

  it("turns pages sideways for bleed, and draws a labelled box when an image is missing", async () => {
    // "Æther" needs a character the standard font can't encode; it's simplified, not an error.
    const { images } = fakeProxyImages();
    const proxySheet = makeProxySheets({
      images: {
        async image(printingId, face) {
          return printingId === "missing" ? null : images.image(printingId, face);
        },
      },
      renderer: pdfLibRenderer(),
    });
    const bytes = await proxySheet(
      [line("bolt", 1), { ...line("missing", 1), name: "Æther Vial ✦" }],
      { ...DEFAULT_PROXY_OPTIONS, bleed: "eighthInch" },
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
  });
});
