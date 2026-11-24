import { splitSymbols } from "@/modules/decks/core/client";
import type { PrintedFace } from "./playtest-card";

// Playtest proxies, the text of a card (design doc 22, section 3): words and symbols, wrapping,
// and shrinking until the rules text fits its box. Pure: the renderer passes a way to measure text.

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
export type Paragraph = Readonly<{ kind: "words"; words: readonly Word[] } | { kind: "divider" }>;

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

export function paragraphsOf(text: string): Paragraph[] {
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

export type FlowedText = Readonly<{
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
export function flow(
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
export function fittingFlow(
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

/** Fits paragraphs inside `height`, falling back to `lastResort` size when needed. */
export function fitParagraphs(
  paragraphs: readonly Paragraph[],
  width: number,
  height: number,
  measure: Measure,
): FlowedText {
  return (
    fittingFlow(paragraphs, width, height, measure, TEXT_SIZES.largest, TEXT_SIZES.smallest) ??
    fittingFlow(paragraphs, width, height, measure, TEXT_SIZES.smallest, TEXT_SIZES.lastResort) ??
    flow(paragraphs, width, TEXT_SIZES.lastResort, measure)
  );
}

/** The largest size, from `largest` down to `smallest`, at which one line fits `width`. */
export function fittingSize(
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
