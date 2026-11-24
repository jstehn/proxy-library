import { colorsOfCost } from "@/modules/decks/core/client";
import type { DrawnSetIcon, RotatedSection } from "./playtest-chrome";
import { classifyFrame, FRAME_LAYOUTS } from "./playtest-layouts";
import type { DrawnSymbol, DrawnText, Measure } from "./playtest-text";
import type { Box, GuideLine, Point } from "./proxy-sheet";
import { COLORS, type ManaColor, isLand, type CardFacts } from "@/shared/mtg";

// Playtest proxies (design doc 22, section 3): a card drawn from its text instead of its scan.
// Everything here is pure: given the card, its box on the page and a way to measure text, it
// works out every shape, word and symbol to draw. The renderer only paints the result.
//
// Units are PDF points (72 per inch); y grows upwards, as in PDF.

/** What's printed on one face, as the catalog stores it. */
export type PrintedFace = Pick<CardFacts, "name" | "manaCost" | "typeLine" | "text"> &
  Readonly<{
    power: string | null;
    toughness: string | null;
    loyalty: string | null;
    defense: string | null;
  }>;

/** What a playtest proxy needs to know about a printing. */
export type PrintedCard = Readonly<{
  faces: readonly PrintedFace[];
  /** Scryfall's layout: "normal", "split", "adventure", "flip", "transform", "modal_dfc", … */
  layout: string;
  /** Whether each face has its own side (transform, modal…), rather than sharing one (split). */
  doubleFaced: boolean;
  colors: readonly string[];
  /** Colours of mana it makes ("W", …, "C"): a land's colour. */
  producedMana: readonly string[];
  setCode: string;
  rarity: string;
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
  if (fromCosts.size > 0) return COLORS.filter((color) => fromCosts.has(color));
  const landFace = faces.some((face) => isLand(face.typeLine));
  const fallback = landFace && card.colors.length === 0 ? card.producedMana : card.colors;
  return COLORS.filter((color) => fallback.includes(color));
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
const STRIPE_WIDTH = 1.5;
const STRIPE_GAP = 6;

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
// The card.

export type PlaytestDrawing = Readonly<{
  /** The card and its bleed: the stripes reach this far, so an off cut shows stripes. */
  bleed: Box;
  stripes: readonly Stripe[];
  /** White boxes with a thin border: title, type line, text box, stats, DFC hint bar. */
  panels: readonly Box[];
  /** Where the art goes, or null when there's none. */
  art: Box | null;
  texts: readonly DrawnText[];
  symbols: readonly DrawnSymbol[];
  /** Set icons drawn on the right of each type bar using the Keyrune font. */
  setIcons: readonly DrawnSetIcon[];
  /** Divider lines inside adventure or multi-section panels. */
  rules: readonly GuideLine[];
  /** Sections rotated 180 degrees around their center (Kamigawa flip cards' bottom half). */
  rotatedSections: readonly RotatedSection[];
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
  const frameKind = classifyFrame(card, faces);
  const laidOut = FRAME_LAYOUTS[frameKind]({ card, side, faces, frame, style, measure });

  return {
    bleed,
    stripes: style.stripes ? stripes(bleed, stripeColors(card, side)) : [],
    panels: laidOut.fragment.panels,
    art: laidOut.art,
    texts: laidOut.fragment.texts,
    symbols: laidOut.fragment.symbols,
    setIcons: laidOut.fragment.setIcons,
    rules: laidOut.fragment.rules,
    rotatedSections: laidOut.rotatedSections,
  };
}
