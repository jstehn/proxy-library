import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makeProxySheets } from "../application/proxy-sheets";
import { symbolArt } from "../domain/mana-symbols";
import { DEFAULT_PROXY_OPTIONS, type ProxyLine, type ProxyOptions } from "../domain/proxy-sheet";
import { fakeProxyImages } from "../testing/fakes";
import { colorTestCards, printedCard } from "../testing/printed-cards";
import { pdfLibRenderer } from "./pdf-lib-renderer";
import { readManaFont } from "./playtest-painter";

const line = (printingId: string, quantity: number, hasBack = false): ProxyLine => ({
  oracleId: printingId,
  ownedReal: 0,
  printingId,
  name: printingId,
  quantity,
  board: "main",
  isBasicLand: false,
  hasBack,
  isFoil: false,
  printed: printedCard(),
});

async function pdfFor(lines: readonly ProxyLine[], options: Partial<ProxyOptions> = {}) {
  const { images } = fakeProxyImages(["delver"]);
  const proxySheet = makeProxySheets({ images, renderer: pdfLibRenderer() });
  const bytes = await proxySheet({ lines, tokens: [] }, { ...DEFAULT_PROXY_OPTIONS, ...options });
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

  it("draws bleed, and a labelled box when an image is missing", async () => {
    // "Æther" needs a character the standard font can't encode; it's simplified, not an error.
    const { images } = fakeProxyImages();
    const proxySheet = makeProxySheets({
      images: {
        async image(printingId, face) {
          return printingId === "missing" ? null : images.image(printingId, face);
        },
        artCrop: images.artCrop,
      },
      renderer: pdfLibRenderer(),
    });
    const bytes = await proxySheet(
      { lines: [line("bolt", 1), { ...line("missing", 1), name: "Æther Vial ✦" }], tokens: [] },
      { ...DEFAULT_PROXY_OPTIONS, bleed: "fillGap" },
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });
});

describe("pdfLibRenderer, playtest style (design doc 22)", () => {
  const testCards = colorTestCards();
  const lines: ProxyLine[] = testCards.map((card, index) => ({
    ...line(`card-${index}`, 1, card.printed.doubleFaced),
    name: card.name,
    printed: card.printed,
  }));

  it.each(["color", "grayscale", "edges", "none"] as const)(
    "draws every colour combination and awkward card with %s art",
    async (artFilter) => {
      const pdf = await pdfFor(lines, { style: "playtest", artFilter });
      // 42 single-sided cards on 5 pages, then Delver's front page and its back page.
      expect(pdf.getPageCount()).toBe(7);
      const images = pdf.context
        .enumerateIndirectObjects()
        .filter(([, object]) => object.toString().includes("/Subtype /Image"));
      // One art image per printing's front (no art at all when it's turned off). The fake has no
      // back image for the double-faced card, so its back prints with an empty art box.
      expect(images.length).toBe(artFilter === "none" ? 0 : testCards.length);
    },
  );

  it("has a glyph in the Mana font for every symbol it draws", async () => {
    const font = fontkit.create(await readManaFont());
    const symbols = JSON.parse(readFileSync("tests/fixtures/scryfall/symbology.json", "utf8")) as {
      data: { symbol: string }[];
    };
    const glyphs = symbols.data.flatMap(({ symbol }) => {
      const art = symbolArt(symbol.slice(1, -1));
      if (art === null) return [];
      return art.kind === "single" ? [art.glyph] : [...art.glyphs];
    });
    const missing = glyphs.filter(
      (glyph) => font.glyphForCodePoint(glyph.codePointAt(0) ?? 0).id === 0,
    );
    expect(missing).toEqual([]);
  });

  it("prints a card whose art is missing, with an empty art box", async () => {
    const proxySheet = makeProxySheets({
      images: { image: async () => null, artCrop: async () => null },
      renderer: pdfLibRenderer(),
    });
    const bytes = await proxySheet(
      { lines: lines.slice(0, 1), tokens: [] },
      {
        ...DEFAULT_PROXY_OPTIONS,
        style: "playtest",
      },
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("pdfLibRenderer progress", () => {
  it("reports each page, then saving", async () => {
    const { images } = fakeProxyImages();
    const proxySheet = makeProxySheets({ images, renderer: pdfLibRenderer() });
    const seen: string[] = [];
    await proxySheet({ lines: [line("bolt", 10)], tokens: [] }, DEFAULT_PROXY_OPTIONS, (progress) =>
      seen.push(`${progress.stage} ${progress.done}/${progress.total}`),
    );
    expect(seen).toEqual([
      "images 0/1",
      "images 1/1",
      "pages 0/2",
      "pages 1/2",
      "pages 2/2",
      "saving 0/1",
    ]);
  });
});
