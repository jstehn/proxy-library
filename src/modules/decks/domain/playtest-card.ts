import {
  colorsOfCost,
  costSymbols,
  MANA_COLORS,
  splitSymbols,
  type ManaColor,
} from "./mana-symbols";
import type { Box, GuideLine, Point } from "./proxy-sheet";

// Playtest proxies (design doc 22, section 3): a card drawn from its text instead of its scan.
// Everything here is pure: given the card, its box on the page and a way to measure text, it
// works out every shape, word and symbol to draw. The renderer only paints the result.
//
// Units are PDF points (72 per inch); y grows upwards, as in PDF.

/** What's printed on one face, as the catalog stores it. */
export type PrintedFace = Readonly<{
  name: string;
  manaCost: string | null;
  typeLine: string;
  text: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
}>;

/** What a playtest proxy needs to know about a printing. */
export type PrintedCard = Readonly<{
  faces: readonly PrintedFace[];
  /** Whether each face has its own side (transform, modal…), rather than sharing one (split). */
  doubleFaced: boolean;
  colors: readonly string[];
  /** Colours of mana it makes ("W", …, "C"): a land's colour. */
  producedMana: readonly string[];
  setCode: string;
  collectorNumber: string;
  artist: string | null;
  /**
   * A token (design doc 25): its art grows into the space its text doesn't need, as on a real
   * token, and a token without text has no text box at all.
   */
  isToken: boolean;
}>;

export type CardSide = "front" | "back";

/** The faces printed on one side: one per side for double-faced cards, all of them otherwise. */
export function facesOnSide(card: PrintedCard, side: CardSide): PrintedFace[] {
  if (!card.doubleFaced) return [...card.faces];
  const face = card.faces[side === "front" ? 0 : 1];
  return face === undefined ? [] : [face];
}

/** A stripe colour: one of the five, or "C" for colourless. */
export type StripeColor = ManaColor | "C";

/**
 * The colours shown by the stripes (section 3.3): the colours of the side's mana costs (so a
 * split card shows both halves), else a land's mana colours, else the printing's colours (a face
 * with a colour indicator and no cost). Empty means colourless.
 */
export function stripeColors(card: PrintedCard, side: CardSide): ManaColor[] {
  const faces = facesOnSide(card, side);
  const fromCosts = new Set(faces.flatMap((face) => colorsOfCost(face.manaCost)));
  if (fromCosts.size > 0) return MANA_COLORS.filter((color) => fromCosts.has(color));
  const isLand = faces.some((face) => /\bLand\b/.test(face.typeLine));
  const fallback = isLand && card.colors.length === 0 ? card.producedMana : card.colors;
  return MANA_COLORS.filter((color) => fallback.includes(color));
}

/**
 * Stripe tints: light, to save ink, but far enough apart to tell any two colours apart. White is
 * a pale cream so it shows on white paper; black is a mid grey, darker than colourless.
 */
export const STRIPE_TINTS: Readonly<Record<StripeColor, string>> = {
  W: "#e8d27e",
  U: "#b9d4ef",
  B: "#9c9692",
  R: "#f2ab96",
  G: "#acd3a5",
  C: "#dcdcdc",
};

// ---------------------------------------------------------------------------------------------
// Shapes: the stripes.

/** Points of a polygon inside the half-plane where `side(point) >= 0` (Sutherland–Hodgman). */
function clipPolygon(polygon: readonly Point[], side: (point: Point) => number): Point[] {
  const kept: Point[] = [];
  polygon.forEach((current, index) => {
    const previous = polygon.at(index - 1) ?? current;
    const currentSide = side(current);
    const previousSide = side(previous);
    if (currentSide >= 0 !== previousSide >= 0) {
      // The edge crosses the boundary: keep the crossing point.
      const t = previousSide / (previousSide - currentSide);
      kept.push({
        x: previous.x + t * (current.x - previous.x),
        y: previous.y + t * (current.y - previous.y),
      });
    }
    if (currentSide >= 0) kept.push(current);
  });
  return kept;
}

/**
 * Each coloured stripe, measured across it, and the white space before the next: thin stripes,
 * far apart, cover about a fifth of the background (changed 2026-10-07 to save ink; they were
 * 5 pt with 5 pt gaps, half the background).
 */
export const STRIPE_WIDTH = 1.5;
export const STRIPE_GAP = 6;

export type Stripe = Readonly<{ color: StripeColor; points: readonly Point[] }>;

/**
 * Diagonal stripes (rising to the right) filling the box: each colour in turn, with white space
 * between. Every stripe is clipped to the box, so nothing is drawn outside it (invariant 1).
 */
export function stripes(box: Box, colors: readonly ManaColor[]): Stripe[] {
  const palette: StripeColor[] = colors.length === 0 ? ["C"] : [...colors];
  const corners: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  // A stripe holds the points whose x − y lies between two values; that difference changes by
  // √2 for each point of distance across the stripe.
  const width = STRIPE_WIDTH * Math.SQRT2;
  const step = (STRIPE_WIDTH + STRIPE_GAP) * Math.SQRT2;
  const lowest = box.x - (box.y + box.height) - width;
  const highest = box.x + box.width - box.y;
  const result: Stripe[] = [];
  for (let index = 0; lowest + index * step < highest; index++) {
    const from = lowest + index * step;
    const color = palette[index % palette.length] ?? "C";
    const inside = clipPolygon(
      clipPolygon(corners, (point) => point.x - point.y - from),
      (point) => from + width - (point.x - point.y),
    );
    if (inside.length >= 3) result.push({ color, points: inside });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Text: words, symbols, wrapping and shrinking.

export type FontStyle = "regular" | "bold" | "italic";

/** How wide `text` is in this font and size (the renderer passes its font's measurer). */
export type Measure = (text: string, font: FontStyle, size: number) => number;

type Piece = Readonly<
  { kind: "text"; text: string; font: FontStyle } | { kind: "symbol"; symbol: string }
>;
/** Pieces with no space between them, which wrap together: "{T}:" is one word. */
type Word = readonly Piece[];
type Paragraph = Readonly<{ kind: "words"; words: readonly Word[] } | { kind: "divider" }>;

/** Symbols in rules text are about 0.8 × the text size across, as measured on real cards. */
export const TEXT_SYMBOL_RATIO = 0.8;
/** The space either side of a symbol in text, as a share of the text size. */
const SYMBOL_SIDE_SPACE = 0.06;
const LINE_HEIGHT = 1.2;
const PARAGRAPH_GAP = 0.35;
const DIVIDER_HEIGHT = 0.9;

/** Words of one line of rules text; reminder text (in parentheses) is italic. */
function wordsOf(text: string, baseFont: FontStyle): Word[] {
  const words: Piece[][] = [[]];
  let depth = 0;
  const current = () => words[words.length - 1] ?? [];
  for (const run of splitSymbols(text)) {
    if (run.kind === "symbol") {
      current().push(run);
      continue;
    }
    // Walk the text one character at a time: spaces end words, parentheses switch to italic.
    let pending = "";
    let pendingFont: FontStyle = depth > 0 ? "italic" : baseFont;
    const flush = () => {
      if (pending !== "") current().push({ kind: "text", text: pending, font: pendingFont });
      pending = "";
    };
    for (const character of run.text) {
      if (character === " ") {
        flush();
        words.push([]);
        continue;
      }
      if (character === "(") depth++;
      const font: FontStyle = depth > 0 ? "italic" : baseFont;
      if (font !== pendingFont) {
        flush();
        pendingFont = font;
      }
      pending += character;
      if (character === ")") depth = Math.max(0, depth - 1);
    }
    flush();
  }
  return words.filter((word) => word.length > 0);
}

function paragraphsOf(text: string): Paragraph[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => ({ kind: "words", words: wordsOf(line, "regular") }));
}

/** The stats printed in the corner: power/toughness, loyalty or defence. */
export function statsOf(face: PrintedFace): string | null {
  if (face.power !== null && face.toughness !== null) return `${face.power}/${face.toughness}`;
  return face.loyalty ?? face.defense;
}

/**
 * The text box's paragraphs: the first face's rules text, then for each further face on this
 * side (split, adventure, flip) a dividing line, its name and cost, its type and its text.
 */
export function textBoxParagraphs(faces: readonly PrintedFace[]): Paragraph[] {
  const [first, ...others] = faces;
  return [
    ...paragraphsOf(first?.text ?? ""),
    ...others.flatMap((face): Paragraph[] => {
      const stats = statsOf(face);
      const heading: Word[] = [
        ...wordsOf(face.name, "bold"),
        ...costSymbols(face.manaCost).map((symbol): Word => [{ kind: "symbol", symbol }]),
      ];
      const typeLine = stats === null ? face.typeLine : `${face.typeLine} (${stats})`;
      return [
        { kind: "divider" },
        { kind: "words", words: heading },
        { kind: "words", words: wordsOf(typeLine, "italic") },
        ...paragraphsOf(face.text),
      ];
    }),
  ];
}

export type DrawnText = Readonly<{
  text: string;
  x: number;
  y: number;
  size: number;
  font: FontStyle;
}>;
/** A symbol's centre and size; cost symbols have Mana's drop shadow, text symbols don't. */
export type DrawnSymbol = Readonly<{
  symbol: string;
  x: number;
  y: number;
  diameter: number;
  shadow: boolean;
}>;

type FlowedText = Readonly<{
  height: number;
  /** Positions relative to the top-left of the text area (y downwards from the top). */
  texts: readonly DrawnText[];
  symbols: readonly DrawnSymbol[];
  dividers: readonly number[];
}>;

function pieceWidth(piece: Piece, size: number, measure: Measure): number {
  if (piece.kind === "text") return measure(piece.text, piece.font, size);
  return size * (TEXT_SYMBOL_RATIO + 2 * SYMBOL_SIDE_SPACE);
}

/** Lay paragraphs out in a column `width` wide at one text size. */
function flow(
  paragraphs: readonly Paragraph[],
  width: number,
  size: number,
  measure: Measure,
): FlowedText {
  const texts: DrawnText[] = [];
  const symbols: DrawnSymbol[] = [];
  const dividers: number[] = [];
  const space = measure(" ", "regular", size);
  const lineHeight = size * LINE_HEIGHT;
  let top = 0;

  paragraphs.forEach((paragraph, index) => {
    if (index > 0) top += size * PARAGRAPH_GAP;
    if (paragraph.kind === "divider") {
      dividers.push(top + (size * DIVIDER_HEIGHT) / 2);
      top += size * DIVIDER_HEIGHT;
      return;
    }
    let x = 0;
    let lineStarted = false;
    for (const word of paragraph.words) {
      const wordWidth = word.reduce((sum, piece) => sum + pieceWidth(piece, size, measure), 0);
      if (lineStarted && x + space + wordWidth > width) {
        top += lineHeight;
        x = 0;
        lineStarted = false;
      }
      if (lineStarted) x += space;
      const baseline = top + size * 0.9;
      for (const piece of word) {
        const pieceSize = pieceWidth(piece, size, measure);
        if (piece.kind === "text") {
          texts.push({ text: piece.text, x, y: baseline, size, font: piece.font });
        } else {
          symbols.push({
            symbol: piece.symbol,
            x: x + pieceSize / 2,
            // Symbols sit a little low on the line, as they do in print.
            y: baseline - size * 0.33,
            diameter: size * TEXT_SYMBOL_RATIO,
            shadow: false,
          });
        }
        x += pieceSize;
      }
      lineStarted = true;
    }
    top += lineHeight;
  });
  return { height: top, texts, symbols, dividers };
}

/** Rules text sizes, largest first: shrink until it fits (section 3.1). */
// Real cards print rules text at about 7.5 pt (measured on M19's Llanowar Elves); short text may
// be a little larger, as on real cards.
export const TEXT_SIZES = { largest: 8.5, smallest: 5, lastResort: 3.5, step: 0.25 } as const;

/** The largest size from `from` down to `to` at which the text fits `height`, or null. */
function fittingFlow(
  paragraphs: readonly Paragraph[],
  width: number,
  height: number,
  measure: Measure,
  from: number,
  to: number,
): FlowedText | null {
  for (let size = from; size >= to - 1e-9; size -= TEXT_SIZES.step) {
    const flowed = flow(paragraphs, width, size, measure);
    if (flowed.height <= height) return flowed;
  }
  return null;
}

/** The largest size, from `largest` down to `smallest`, at which one line fits `width`. */
function fittingSize(
  text: string,
  font: FontStyle,
  width: number,
  largest: number,
  smallest: number,
  measure: Measure,
): number {
  for (let size = largest; size > smallest; size -= TEXT_SIZES.step) {
    if (measure(text, font, size) <= width) return size;
  }
  return smallest;
}

// ---------------------------------------------------------------------------------------------
// The card.

/** Mana cost symbols: 3.0 mm across, 0.3 mm apart, as measured on real cards (section 3.4). */
export const COST_SYMBOL_DIAMETER = (3.0 / 25.4) * 72;
export const COST_SYMBOL_GAP = (0.3 / 25.4) * 72;

const MARGIN = 7;
const GAP = 3;
const TITLE_HEIGHT = 16;
const TYPE_HEIGHT = 14;
const FOOTER_HEIGHT = 12;
const FOOTER_BOTTOM = 5;
const ART_HEIGHT = 105;
/** Below this the art is too small to be worth printing, and the text gets its space. */
const SMALLEST_ART = 30;
const PADDING = 4;
/** The text size a token's art leaves room for: about a real card's. */
const TOKEN_TEXT_SIZE = 7.5;

export type PlaytestDrawing = Readonly<{
  /** The card and its bleed: the stripes reach this far, so an off cut shows stripes. */
  bleed: Box;
  stripes: readonly Stripe[];
  /** White boxes with a thin border: title, type line, text box, stats. */
  panels: readonly Box[];
  /** Where the art goes, or null when there's none. */
  art: Box | null;
  texts: readonly DrawnText[];
  symbols: readonly DrawnSymbol[];
  /** Lines between the faces of a split or adventure card. */
  rules: readonly GuideLine[];
}>;

export type PlaytestStyle = Readonly<{ art: boolean; stripes: boolean }>;

/**
 * Everything to draw for one side of a card in `frame` (the card's cut lines). `bleed` is the
 * card plus its bleed (the frame itself when there's none).
 */
export function playtestCard(
  card: PrintedCard,
  side: CardSide,
  frame: Box,
  style: PlaytestStyle,
  measure: Measure,
  bleed: Box = frame,
): PlaytestDrawing {
  const faces = facesOnSide(card, side);
  const face = faces[0] ?? card.faces[0];
  const texts: DrawnText[] = [];
  const symbols: DrawnSymbol[] = [];
  const panels: Box[] = [];
  const innerX = frame.x + MARGIN;
  const innerWidth = frame.width - 2 * MARGIN;
  const top = frame.y + frame.height;

  // Title bar: the name, shrunk to fit beside the mana cost on the right.
  const title: Box = {
    x: innerX,
    y: top - MARGIN - TITLE_HEIGHT,
    width: innerWidth,
    height: TITLE_HEIGHT,
  };
  panels.push(title);
  const cost = costSymbols(face?.manaCost ?? null);
  const costWidth =
    cost.length === 0
      ? 0
      : cost.length * COST_SYMBOL_DIAMETER + (cost.length - 1) * COST_SYMBOL_GAP;
  cost.forEach((symbol, index) => {
    const fromRight = cost.length - 1 - index;
    symbols.push({
      symbol,
      x:
        title.x +
        title.width -
        PADDING -
        COST_SYMBOL_DIAMETER / 2 -
        fromRight * (COST_SYMBOL_DIAMETER + COST_SYMBOL_GAP),
      y: title.y + title.height / 2,
      diameter: COST_SYMBOL_DIAMETER,
      shadow: true,
    });
  });
  const name = face?.name ?? "";
  const nameWidth = title.width - 2 * PADDING - costWidth - (costWidth > 0 ? GAP : 0);
  const nameSize = fittingSize(name, "bold", nameWidth, 9, 4, measure);
  texts.push({
    text: name,
    x: title.x + PADDING,
    y: title.y + title.height / 2 - nameSize * 0.36,
    size: nameSize,
    font: "bold",
  });

  // Footer: set, number and artist on the stripes; the stats in a box on the right.
  const footerY = frame.y + FOOTER_BOTTOM;
  const stats = face === undefined ? null : statsOf(face);
  let statsWidth = 0;
  if (stats !== null) {
    const statsSize = 9;
    statsWidth = measure(stats, "bold", statsSize) + 2 * PADDING;
    const statsBox: Box = {
      x: innerX + innerWidth - statsWidth,
      y: footerY,
      width: statsWidth,
      height: FOOTER_HEIGHT,
    };
    panels.push(statsBox);
    texts.push({
      text: stats,
      x: statsBox.x + PADDING,
      y: statsBox.y + FOOTER_HEIGHT / 2 - statsSize * 0.36,
      size: statsSize,
      font: "bold",
    });
  }
  const credit = [card.setCode.toUpperCase(), card.collectorNumber, card.artist]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  const creditSize = fittingSize(
    credit,
    "regular",
    innerWidth - statsWidth - GAP,
    5.5,
    3.5,
    measure,
  );
  texts.push({
    text: credit,
    x: innerX,
    y: footerY + FOOTER_HEIGHT / 2 - creditSize * 0.36,
    size: creditSize,
    font: "regular",
  });

  // Between the title and the footer: art, type line, text box. The text box gets what's left,
  // and if the text won't fit even at the smallest size, it takes space from the art.
  const bodyTop = title.y - GAP;
  const bodyBottom = footerY + FOOTER_HEIGHT + GAP;
  const paragraphs = textBoxParagraphs(faces.length > 0 ? faces : card.faces.slice(0, 1));
  const textWidth = innerWidth - 2 * PADDING;
  const textHeightWith = (artHeight: number) =>
    bodyTop - bodyBottom - TYPE_HEIGHT - GAP - (artHeight > 0 ? artHeight + GAP : 0) - 2 * PADDING;

  let artHeight = style.art ? ART_HEIGHT : 0;
  // Everything between the title and the footer except the type line: the art and text share it.
  const artAndText = bodyTop - bodyBottom - TYPE_HEIGHT - GAP;
  const textless = paragraphs.length === 0;
  if (card.isToken && style.art) {
    // Room for the text at a real card's size (none without text); the art takes the rest,
    // and never less than a card's art.
    const textNeeds = textless
      ? 0
      : GAP + flow(paragraphs, textWidth, TOKEN_TEXT_SIZE, measure).height + 2 * PADDING;
    artHeight = Math.max(artHeight, artAndText - textNeeds);
  }
  const hasTextBox = !(card.isToken && textless && artHeight > 0);
  let flowed = hasTextBox
    ? fittingFlow(
        paragraphs,
        textWidth,
        textHeightWith(artHeight),
        measure,
        TEXT_SIZES.largest,
        TEXT_SIZES.smallest,
      )
    : flow(paragraphs, textWidth, TEXT_SIZES.largest, measure);
  if (flowed === null) {
    const needed = flow(paragraphs, textWidth, TEXT_SIZES.smallest, measure);
    const shrunk = artHeight - (needed.height - textHeightWith(artHeight));
    artHeight = shrunk >= SMALLEST_ART ? shrunk : 0;
    flowed =
      fittingFlow(
        paragraphs,
        textWidth,
        textHeightWith(artHeight),
        measure,
        TEXT_SIZES.smallest,
        TEXT_SIZES.lastResort,
      ) ?? flow(paragraphs, textWidth, TEXT_SIZES.lastResort, measure);
  }

  const art: Box | null =
    artHeight > 0
      ? { x: innerX, y: bodyTop - artHeight, width: innerWidth, height: artHeight }
      : null;
  const typeBox: Box = {
    x: innerX,
    y: (art === null ? bodyTop : art.y - GAP) - TYPE_HEIGHT,
    width: innerWidth,
    height: TYPE_HEIGHT,
  };
  panels.push(typeBox);
  const typeLine = face?.typeLine ?? "";
  const typeSize = fittingSize(typeLine, "bold", innerWidth - 2 * PADDING, 7.5, 4, measure);
  texts.push({
    text: typeLine,
    x: typeBox.x + PADDING,
    y: typeBox.y + TYPE_HEIGHT / 2 - typeSize * 0.36,
    size: typeSize,
    font: "bold",
  });

  const textBox: Box = {
    x: innerX,
    y: bodyBottom,
    width: innerWidth,
    height: typeBox.y - GAP - bodyBottom,
  };
  if (hasTextBox) panels.push(textBox);
  // Short text sits in the middle of the box, as on real cards; long text starts at the top.
  const areaHeight = textBox.height - 2 * PADDING;
  const areaTop =
    textBox.y + textBox.height - PADDING - Math.max(0, (areaHeight - flowed.height) / 2);
  const areaLeft = textBox.x + PADDING;
  for (const text of flowed.texts)
    texts.push({ ...text, x: areaLeft + text.x, y: areaTop - text.y });
  for (const symbol of flowed.symbols)
    symbols.push({ ...symbol, x: areaLeft + symbol.x, y: areaTop - symbol.y });
  const rules = flowed.dividers.map((offset) => ({
    from: { x: textBox.x + PADDING, y: areaTop - offset },
    to: { x: textBox.x + textBox.width - PADDING, y: areaTop - offset },
  }));

  return {
    bleed,
    stripes: style.stripes ? stripes(bleed, stripeColors(card, side)) : [],
    panels,
    art,
    texts,
    symbols,
    rules,
  };
}
