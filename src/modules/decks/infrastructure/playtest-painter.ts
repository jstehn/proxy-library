import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import jpeg from "jpeg-js";
import {
  closePath,
  concatTransformationMatrix,
  drawObject,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  StandardFonts,
  type Color,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  cropToAspect,
  grayscale,
  sobelEdges,
  type GrayPixels,
  type Pixels,
} from "../domain/art-filters";
import { symbolArt, type SymbolArt } from "../domain/mana-symbols";
import {
  STRIPE_TINTS,
  type DrawnSymbol,
  type FontStyle,
  type Measure,
  type PlaytestDrawing,
} from "../domain/playtest-card";
import type { Box, Point, ProxyOptions } from "../domain/proxy-sheet";

// Paints playtest proxies (design doc 22) into a pdf-lib document. The layout is already decided
// (domain/playtest-card.ts); this draws it: stripes, white panels, art, words and Mana symbols.

/** Where the Mana font lives: the `mana-font` package (SIL OFL 1.1), installed with the app. */
export const MANA_FONT_PATH = join(process.cwd(), "node_modules", "mana-font", "fonts", "mana.ttf");

export async function readManaFont(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(MANA_FONT_PATH));
}

const INK = rgb(0x11 / 255, 0x11 / 255, 0x11 / 255);
const PANEL_BORDER = rgb(0.35, 0.35, 0.35);
const WHITE = rgb(1, 1, 1);
const PANEL_LINE = 0.5;
const OUTLINE_LINE = 0.75;
/** Quality of re-encoded colour art: high, since it's printed. */
const JPEG_QUALITY = 90;

function color(hex: string): Color {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/** Characters the standard fonts lack, and what prints instead. */
const STAND_INS: Record<string, string> = { "−": "-", "∞": "oo", "½": "1/2", "★": "*" };

/** The text with every character the font can't draw replaced by its closest plain letters. */
export function drawable(font: PDFFont, text: string): string {
  let result = "";
  for (const character of text) {
    try {
      font.encodeText(character);
      result += character;
    } catch {
      result += STAND_INS[character] ?? character.normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
    }
  }
  return result;
}

type ArtFilter = ProxyOptions["artFilter"];

export type PlaytestPainter = Readonly<{
  measure: Measure;
  paint(
    page: PDFPage,
    drawing: PlaytestDrawing,
    art: Uint8Array | null,
    artKey: string,
  ): Promise<void>;
}>;

/** A painter for one document: embeds the fonts once, and each art crop once per shape. */
export async function makePlaytestPainter(
  document: PDFDocument,
  manaFontBytes: Uint8Array,
  filter: ArtFilter,
): Promise<PlaytestPainter> {
  document.registerFontkit(fontkit);
  const fonts: Record<FontStyle, PDFFont> = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    italic: await document.embedFont(StandardFonts.HelveticaOblique),
  };
  const mana = await document.embedFont(manaFontBytes, { subset: true });
  // pdf-lib can't tell where a glyph's ink is; fontkit reads it from the font, to centre symbols.
  const manaOutlines = fontkit.create(manaFontBytes);

  function measure(text: string, font: FontStyle, size: number): number {
    return fonts[font].widthOfTextAtSize(drawable(fonts[font], text), size);
  }

  function polygon(page: PDFPage, points: readonly Point[], fillColor: Color) {
    const [first, ...rest] = points;
    if (first === undefined) return;
    page.pushOperators(
      pushGraphicsState(),
      setFillingRgbColor(...rgbParts(fillColor)),
      moveTo(first.x, first.y),
      ...rest.map((point) => lineTo(point.x, point.y)),
      closePath(),
      fill(),
      popGraphicsState(),
    );
  }

  /**
   * Draws a Mana glyph of em-size `size` with the middle of its ink at (x, y), made smaller if
   * its ink would be wider than `widest` (`{100}` and `{1000000}` are wide).
   */
  function glyph(
    page: PDFPage,
    character: string,
    x: number,
    y: number,
    requested: number,
    widest: number,
    ink: Color,
  ) {
    const outline = manaOutlines.glyphForCodePoint(character.codePointAt(0) ?? 0);
    const { minX, maxX, minY, maxY } = outline.bbox;
    const inkWidth = ((maxX - minX) / manaOutlines.unitsPerEm) * requested;
    const size = inkWidth > widest ? (requested * widest) / inkWidth : requested;
    const scale = size / manaOutlines.unitsPerEm;
    page.drawText(character, {
      x: x - ((minX + maxX) / 2) * scale,
      y: y - ((minY + maxY) / 2) * scale,
      size,
      font: mana,
      color: ink,
    });
  }

  /** The half of a circle below the line from its top-right to its bottom-left. */
  function lowerRightHalf(x: number, y: number, radius: number): Point[] {
    const steps = 24;
    return Array.from({ length: steps + 1 }, (_, step) => {
      const angle = Math.PI / 4 - (Math.PI * step) / steps;
      return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
    });
  }

  /**
   * One symbol the way Mana's stylesheet draws `.ms .ms-cost (.ms-shadow)`: a circle 1.3 times
   * the glyph's size, the glyph centred on it, and for costs a small shadow down and to the left.
   */
  function symbol(page: PDFPage, drawn: DrawnSymbol) {
    const art: SymbolArt | null = symbolArt(drawn.symbol);
    const radius = drawn.diameter / 2;
    const em = drawn.diameter / 1.3;
    if (drawn.shadow) {
      // box-shadow: -0.06em 0.07em 0 #111, 0 0.06em 0 #111 (CSS y grows downwards).
      page.drawCircle({ x: drawn.x - 0.06 * em, y: drawn.y - 0.07 * em, size: radius, color: INK });
      page.drawCircle({ x: drawn.x, y: drawn.y - 0.06 * em, size: radius, color: INK });
    }
    if (art === null) {
      // Not in the font: a grey circle with the symbol's letters.
      page.drawCircle({ x: drawn.x, y: drawn.y, size: radius, color: color("#beb9b2") });
      const label = drawable(fonts.bold, drawn.symbol);
      const size = em * 0.7;
      const width = fonts.bold.widthOfTextAtSize(label, size);
      page.drawText(label, {
        x: drawn.x - width / 2,
        y: drawn.y - size * 0.36,
        size,
        font: fonts.bold,
        color: INK,
      });
      return;
    }
    if (art.kind === "single") {
      page.drawCircle({ x: drawn.x, y: drawn.y, size: radius, color: color(art.background) });
      glyph(
        page,
        art.glyph,
        drawn.x,
        drawn.y,
        em * art.scale,
        drawn.diameter * 0.8,
        color(art.foreground),
      );
      return;
    }
    // Hybrid: top-left half one colour, bottom-right the other, a small glyph in each.
    page.drawCircle({ x: drawn.x, y: drawn.y, size: radius, color: color(art.backgrounds[0]) });
    polygon(page, lowerRightHalf(drawn.x, drawn.y, radius), color(art.backgrounds[1]));
    const small = em * 0.55 * art.scale;
    const offset = radius * 0.42;
    glyph(
      page,
      art.glyphs[0],
      drawn.x - offset,
      drawn.y + offset,
      small,
      radius * 0.8,
      color(art.foreground),
    );
    glyph(
      page,
      art.glyphs[1],
      drawn.x + offset,
      drawn.y - offset,
      small,
      radius * 0.8,
      color(art.foreground),
    );
  }

  // Each art crop, cut to its box's shape and filtered, is put in the file once.
  const artObjects = new Map<string, ((page: PDFPage, box: Box) => void) | null>();

  async function artDrawer(bytes: Uint8Array, box: Box) {
    let pixels: Pixels;
    try {
      const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
      pixels = {
        width: decoded.width,
        height: decoded.height,
        data: new Uint8ClampedArray(decoded.data),
      };
    } catch {
      return null; // a damaged image: the art box stays empty (invariant 5)
    }
    const cropped = cropToAspect(pixels, box.width / box.height);
    if (filter === "color") {
      const encoded = jpeg.encode({ ...cropped, data: cropped.data }, JPEG_QUALITY);
      const image = await document.embedJpg(new Uint8Array(encoded.data));
      return (page: PDFPage, at: Box) => page.drawImage(image, at);
    }
    // Grey and edges are drawn as DeviceGray images: one channel, which printers print with
    // black ink, and which compresses well (edges are mostly white).
    const gray: GrayPixels = filter === "edges" ? sobelEdges(cropped) : grayscale(cropped);
    const reference = document.context.register(
      // Photos compress far better with the Paeth predictor; mostly-white edges better without.
      document.context.flateStream(
        filter === "grayscale" ? paethRows(gray) : new Uint8Array(gray.data),
        {
          Type: "XObject",
          Subtype: "Image",
          Width: gray.width,
          Height: gray.height,
          BitsPerComponent: 8,
          ColorSpace: "DeviceGray",
          ...(filter === "grayscale"
            ? {
                DecodeParms: { Predictor: 15, Colors: 1, BitsPerComponent: 8, Columns: gray.width },
              }
            : {}),
        },
      ),
    );
    return (page: PDFPage, at: Box) => {
      const name = page.node.newXObject("Art", reference);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(at.width, 0, 0, at.height, at.x, at.y),
        drawObject(name),
        popGraphicsState(),
      );
    };
  }

  async function paint(
    page: PDFPage,
    drawing: PlaytestDrawing,
    art: Uint8Array | null,
    artKey: string,
  ) {
    page.drawRectangle({ ...drawing.bleed, color: WHITE });
    for (const stripe of drawing.stripes)
      polygon(page, stripe.points, color(STRIPE_TINTS[stripe.color]));
    for (const panel of drawing.panels) {
      page.drawRectangle({
        ...panel,
        color: WHITE,
        borderColor: PANEL_BORDER,
        borderWidth: PANEL_LINE,
      });
    }
    if (drawing.art !== null) {
      const box = drawing.art;
      const key = `${artKey}@${(box.width / box.height).toFixed(3)}`;
      if (!artObjects.has(key))
        artObjects.set(key, art === null ? null : await artDrawer(art, box));
      artObjects.get(key)?.(page, box);
      page.drawRectangle({ ...box, borderColor: PANEL_BORDER, borderWidth: PANEL_LINE });
    }
    page.drawRectangle({ ...drawing.outline, borderColor: INK, borderWidth: OUTLINE_LINE });
    for (const text of drawing.texts) {
      const font = fonts[text.font];
      page.drawText(drawable(font, text.text), {
        x: text.x,
        y: text.y,
        size: text.size,
        font,
        color: INK,
      });
    }
    for (const rule of drawing.rules) {
      page.drawLine({ start: rule.from, end: rule.to, thickness: PANEL_LINE, color: PANEL_BORDER });
    }
    for (const drawn of drawing.symbols) symbol(page, drawn);
  }

  return { measure, paint };
}

/**
 * The image's rows with PNG's Paeth filter (what PDF calls predictor 15): each byte becomes the
 * difference from a guess made from its left, upper and upper-left neighbours. Photos change
 * gradually, so the differences are small numbers that compress far better than the pixels.
 */
function paethRows(image: GrayPixels): Uint8Array {
  const { width, height, data } = image;
  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 4; // this row uses the Paeth filter
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? (data[y * width + x - 1] ?? 0) : 0;
      const up = y > 0 ? (data[(y - 1) * width + x] ?? 0) : 0;
      const upLeft = x > 0 && y > 0 ? (data[(y - 1) * width + x - 1] ?? 0) : 0;
      const estimate = left + up - upLeft;
      const fromLeft = Math.abs(estimate - left);
      const fromUp = Math.abs(estimate - up);
      const fromUpLeft = Math.abs(estimate - upLeft);
      const guess =
        fromLeft <= fromUp && fromLeft <= fromUpLeft ? left : fromUp <= fromUpLeft ? up : upLeft;
      rows[y * (width + 1) + 1 + x] = ((data[y * width + x] ?? 0) - guess) & 255;
    }
  }
  return rows;
}

function rgbParts(value: Color): [number, number, number] {
  if (value.type !== "RGB") return [0, 0, 0];
  return [value.red, value.green, value.blue];
}
