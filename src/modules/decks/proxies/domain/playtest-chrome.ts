import { costSymbols } from "@/modules/decks/core/client";
import { hasTypeWord } from "@/shared/mtg";
import type { CardSide, PrintedCard, PrintedFace } from "./playtest-card";
import {
  fittingSize,
  statsOf,
  type DrawnSymbol,
  type DrawnText,
  type FlowedText,
  type Measure,
} from "./playtest-text";
import type { Box, GuideLine, Point } from "./proxy-sheet";

// Immutable drawing primitives and shared card chrome for playtest proxies: title bar, DFC icons
// and hint bar, type bar, footer, token badge, cost symbols, and flowed text placement.

/** Mana cost symbols: 3.0 mm across, 0.3 mm apart, as measured on real cards. */
export const COST_SYMBOL_DIAMETER = (3.0 / 25.4) * 72;
const COST_SYMBOL_GAP = (0.3 / 25.4) * 72;

export const LAYOUT = {
  margin: 7,
  gap: 3,
  padding: 4,
  titleHeight: 16,
  typeHeight: 14,
  footerHeight: 12,
  footerBottom: 5,
  hintHeight: 13,
  artHeight: 105,
  /** Below this the art is too small to be worth printing, and the text gets its space. */
  smallestArt: 30,
  /** The text size a token's art leaves room for: about a real card's. */
  tokenTextSize: 7.5,
  dfcIconDiameter: 9.5,
  halfTitleHeight: 14,
  halfTypeHeight: 12,
  halfGap: 2,
  splitArtHeight: 34,
  flipArtHeight: 44,
} as const;

/** A set symbol placed on the right of a type bar, rendered with Keyrune in its rarity colour. */
export type DrawnSetIcon = Readonly<{
  setCode: string;
  rarity: string;
  x: number;
  y: number;
  size: number;
}>;

/** Immutable bundle of shapes, words, symbols and dividers produced by one layout step. */
export type DrawingFragment = Readonly<{
  panels: readonly Box[];
  texts: readonly DrawnText[];
  symbols: readonly DrawnSymbol[];
  setIcons: readonly DrawnSetIcon[];
  rules: readonly GuideLine[];
}>;

export const EMPTY_FRAGMENT: DrawingFragment = {
  panels: [],
  texts: [],
  symbols: [],
  setIcons: [],
  rules: [],
};

/** Combines immutable drawing fragments in paint order. */
export function mergeFragments(...fragments: readonly DrawingFragment[]): DrawingFragment {
  return {
    panels: fragments.flatMap((fragment) => fragment.panels),
    texts: fragments.flatMap((fragment) => fragment.texts),
    symbols: fragments.flatMap((fragment) => fragment.symbols),
    setIcons: fragments.flatMap((fragment) => fragment.setIcons),
    rules: fragments.flatMap((fragment) => fragment.rules),
  };
}

/** A sub-section drawn rotated 180 degrees around `center` (Kamigawa flip cards' bottom half). */
export type RotatedSection = DrawingFragment & Readonly<{ center: Point }>;

type DfcIconPair = Readonly<{ front: string; back: string }>;

const DEFAULT_DFC_ICONS: DfcIconPair = { front: "DFC_FRONT", back: "DFC_BACK" };
const DFC_ICONS_BY_LAYOUT: Readonly<Record<string, DfcIconPair>> = {
  modal_dfc: { front: "MDFC_FRONT", back: "MDFC_BACK" },
  meld: { front: "DFC_MELD", back: "DFC_MELD" },
};

/** The Mana-font DFC icon key for one side of a double-faced card. */
export function dfcIconSymbol(layout: string, side: CardSide): string {
  const pair = DFC_ICONS_BY_LAYOUT[layout] ?? DEFAULT_DFC_ICONS;
  return pair[side];
}

/** What a double-faced side needs to signal its flip/transform nature. */
export type DfcCue = Readonly<{
  icon: string;
  otherFace: PrintedFace | null;
  otherIcon: string;
}>;

/** Builds the DFC cue for one side of a card, or null for single-faced cards. */
export function dfcCueFor(card: PrintedCard, side: CardSide): DfcCue | null {
  if (!card.doubleFaced) return null;
  const otherSide: CardSide = side === "front" ? "back" : "front";
  return {
    icon: dfcIconSymbol(card.layout, side),
    otherFace: card.faces[otherSide === "front" ? 0 : 1] ?? null,
    otherIcon: dfcIconSymbol(card.layout, otherSide),
  };
}

/** Short uppercase badge for a token, emblem, or helper card. */
export function tokenBadgeLabel(typeLine: string): "TOKEN" | "EMBLEM" | "HELPER" {
  if (hasTypeWord(typeLine, ["Emblem"])) return "EMBLEM";
  return hasTypeWord(typeLine, ["Token"]) ? "TOKEN" : "HELPER";
}

type CostRowSpec = Readonly<{
  manaCost: string | null;
  rightEdge: number;
  centerY: number;
  diameter: number;
  gap: number;
  shadow: boolean;
}>;

/** Lays out a row of mana cost symbols aligned to `rightEdge`, returning them and their width. */
function layoutCostRow(
  spec: CostRowSpec,
): Readonly<{ symbols: readonly DrawnSymbol[]; width: number }> {
  const cost = costSymbols(spec.manaCost);
  if (cost.length === 0) return { symbols: [], width: 0 };
  const symbols = cost.map((symbol, index): DrawnSymbol => {
    const fromRight = cost.length - 1 - index;
    return {
      symbol,
      x: spec.rightEdge - spec.diameter / 2 - fromRight * (spec.diameter + spec.gap),
      y: spec.centerY,
      diameter: spec.diameter,
      shadow: spec.shadow,
    };
  });
  const width = cost.length * spec.diameter + (cost.length - 1) * spec.gap;
  return { symbols, width };
}

export type TitleBarOptions = Readonly<{
  dfcIcon?: string;
  tokenBadge?: string;
  symbolDiameter?: number;
  maxNameSize?: number;
}>;

/** Builds a title panel: optional DFC icon on left, mana cost / token badge on right, name between. */
export function buildTitleBar(
  box: Box,
  face: PrintedFace | undefined,
  options: TitleBarOptions,
  measure: Measure,
): DrawingFragment {
  const panels: Box[] = [box];
  const texts: DrawnText[] = [];
  const symbols: DrawnSymbol[] = [];
  let leftEdge = box.x + LAYOUT.padding;
  let rightEdge = box.x + box.width - LAYOUT.padding;
  const centerY = box.y + box.height / 2;

  if (options.dfcIcon !== undefined) {
    const diameter = Math.min(LAYOUT.dfcIconDiameter, box.height - 4);
    symbols.push({
      symbol: options.dfcIcon,
      x: leftEdge + diameter / 2,
      y: centerY,
      diameter,
      shadow: false,
    });
    leftEdge += diameter + LAYOUT.gap;
  }

  const symbolDiameter = options.symbolDiameter ?? COST_SYMBOL_DIAMETER;
  const costRow = layoutCostRow({
    manaCost: face?.manaCost ?? null,
    rightEdge,
    centerY,
    diameter: symbolDiameter,
    gap: COST_SYMBOL_GAP * (symbolDiameter / COST_SYMBOL_DIAMETER),
    shadow: true,
  });
  symbols.push(...costRow.symbols);
  if (costRow.width > 0) rightEdge -= costRow.width + LAYOUT.gap;

  if (options.tokenBadge !== undefined) {
    const badgeSize = 5;
    const badgeWidth = measure(options.tokenBadge, "bold", badgeSize) + 5;
    const badgeHeight = Math.min(9, box.height - 4);
    const badgeBox: Box = {
      x: rightEdge - badgeWidth,
      y: box.y + (box.height - badgeHeight) / 2,
      width: badgeWidth,
      height: badgeHeight,
    };
    panels.push(badgeBox);
    texts.push({
      text: options.tokenBadge,
      x: badgeBox.x + 2.5,
      y: badgeBox.y + badgeHeight / 2 - badgeSize * 0.36,
      size: badgeSize,
      font: "bold",
    });
    rightEdge -= badgeWidth + LAYOUT.gap;
  }

  const name = face?.name ?? "";
  const availableWidth = Math.max(10, rightEdge - leftEdge);
  const nameSize = fittingSize(name, "bold", availableWidth, options.maxNameSize ?? 9, 4, measure);
  const nameWidth = measure(name, "bold", nameSize);
  const centered = options.tokenBadge !== undefined;
  texts.push({
    text: name,
    x: centered ? leftEdge + Math.max(0, (availableWidth - nameWidth) / 2) : leftEdge,
    y: centerY - nameSize * 0.36,
    size: nameSize,
    font: "bold",
  });
  return { panels, texts, symbols, setIcons: [], rules: [] };
}

export type TypeBarOptions = Readonly<{
  stats?: string | null;
  setIcon?: Readonly<{ setCode: string; rarity: string }>;
  maxSize?: number;
}>;

/** Builds a type-line panel with optional right-aligned stats and Keyrune set icon. */
export function buildTypeBar(
  box: Box,
  typeLine: string,
  options: TypeBarOptions,
  measure: Measure,
): DrawingFragment {
  const texts: DrawnText[] = [];
  const setIcons: DrawnSetIcon[] = [];
  const centerY = box.y + box.height / 2;
  const maxSize = options.maxSize ?? 7.5;
  let rightEdge = box.x + box.width - LAYOUT.padding;

  if (options.stats !== undefined && options.stats !== null) {
    const statsSize = Math.min(maxSize, 7.5);
    const statsWidth = measure(options.stats, "bold", statsSize);
    texts.push({
      text: options.stats,
      x: rightEdge - statsWidth,
      y: centerY - statsSize * 0.36,
      size: statsSize,
      font: "bold",
    });
    rightEdge -= statsWidth + LAYOUT.gap;
  }

  if (options.setIcon !== undefined && options.setIcon.setCode !== "") {
    const iconSize = Math.min(9.5, box.height - 3);
    setIcons.push({
      setCode: options.setIcon.setCode,
      rarity: options.setIcon.rarity,
      x: rightEdge - iconSize / 2,
      y: centerY,
      size: iconSize,
    });
    rightEdge -= iconSize + LAYOUT.gap;
  }

  const availableWidth = Math.max(10, rightEdge - (box.x + LAYOUT.padding));
  const typeSize = fittingSize(typeLine, "bold", availableWidth, maxSize, 4, measure);
  texts.push({
    text: typeLine,
    x: box.x + LAYOUT.padding,
    y: centerY - typeSize * 0.36,
    size: typeSize,
    font: "bold",
  });
  return { panels: [box], texts, symbols: [], setIcons, rules: [] };
}

/** Builds the footer (credit + optional stats box) and returns the y where the body begins. */
export function buildFooter(
  frame: Box,
  innerX: number,
  innerWidth: number,
  card: PrintedCard,
  statsFace: PrintedFace | undefined,
  measure: Measure,
): Readonly<{ fragment: DrawingFragment; bodyBottom: number }> {
  const footerY = frame.y + LAYOUT.footerBottom;
  const stats = statsFace === undefined ? null : statsOf(statsFace);
  const panels: Box[] = [];
  const texts: DrawnText[] = [];
  let statsWidth = 0;

  if (stats !== null) {
    const statsSize = 9;
    statsWidth = measure(stats, "bold", statsSize) + 2 * LAYOUT.padding;
    const statsBox: Box = {
      x: innerX + innerWidth - statsWidth,
      y: footerY,
      width: statsWidth,
      height: LAYOUT.footerHeight,
    };
    panels.push(statsBox);
    texts.push({
      text: stats,
      x: statsBox.x + LAYOUT.padding,
      y: statsBox.y + LAYOUT.footerHeight / 2 - statsSize * 0.36,
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
    innerWidth - statsWidth - LAYOUT.gap,
    5.5,
    3.5,
    measure,
  );
  texts.push({
    text: credit,
    x: innerX,
    y: footerY + LAYOUT.footerHeight / 2 - creditSize * 0.36,
    size: creditSize,
    font: "regular",
  });
  return {
    fragment: { panels, texts, symbols: [], setIcons: [], rules: [] },
    bodyBottom: footerY + LAYOUT.footerHeight + LAYOUT.gap,
  };
}

/** Builds a slim bottom hint bar showing the other side of a double-faced card. */
export function buildDfcHintBar(box: Box, cue: DfcCue, measure: Measure): DrawingFragment {
  if (cue.otherFace === null) return EMPTY_FRAGMENT;
  const otherFace = cue.otherFace;
  const texts: DrawnText[] = [];
  const symbols: DrawnSymbol[] = [];
  const iconDiameter = 7.5;
  const centerY = box.y + box.height / 2;
  let leftEdge = box.x + LAYOUT.padding;
  let rightEdge = box.x + box.width - LAYOUT.padding;

  symbols.push({
    symbol: cue.otherIcon,
    x: leftEdge + iconDiameter / 2,
    y: centerY,
    diameter: iconDiameter,
    shadow: false,
  });
  leftEdge += iconDiameter + LAYOUT.gap;

  const costRow = layoutCostRow({
    manaCost: otherFace.manaCost,
    rightEdge,
    centerY,
    diameter: 6.5,
    gap: 0.8,
    shadow: false,
  });
  symbols.push(...costRow.symbols);
  if (costRow.width > 0) {
    rightEdge -= costRow.width + LAYOUT.gap;
  } else {
    const stats = statsOf(otherFace);
    if (stats !== null) {
      const statsSize = 6.5;
      const statsWidth = measure(stats, "bold", statsSize);
      texts.push({
        text: stats,
        x: rightEdge - statsWidth,
        y: centerY - statsSize * 0.36,
        size: statsSize,
        font: "bold",
      });
      rightEdge -= statsWidth + LAYOUT.gap;
    }
  }

  const label =
    otherFace.typeLine === "" ? otherFace.name : `${otherFace.name} — ${otherFace.typeLine}`;
  const availableWidth = Math.max(10, rightEdge - leftEdge);
  const labelSize = fittingSize(label, "regular", availableWidth, 6, 3.8, measure);
  texts.push({
    text: label,
    x: leftEdge,
    y: centerY - labelSize * 0.36,
    size: labelSize,
    font: "regular",
  });
  return { panels: [box], texts, symbols, setIcons: [], rules: [] };
}

/** Places flowed text vertically centred (when short) or top-aligned (when long) inside `box`. */
export function placeFlowedInBox(box: Box, flowed: FlowedText): DrawingFragment {
  const areaHeight = box.height - 2 * LAYOUT.padding;
  const areaTop =
    box.y + box.height - LAYOUT.padding - Math.max(0, (areaHeight - flowed.height) / 2);
  const areaLeft = box.x + LAYOUT.padding;
  return {
    panels: [],
    texts: flowed.texts.map((text) => ({ ...text, x: areaLeft + text.x, y: areaTop - text.y })),
    symbols: flowed.symbols.map((symbol) => ({
      ...symbol,
      x: areaLeft + symbol.x,
      y: areaTop - symbol.y,
    })),
    setIcons: [],
    rules: flowed.dividers.map((offset) => ({
      from: { x: box.x + LAYOUT.padding, y: areaTop - offset },
      to: { x: box.x + box.width - LAYOUT.padding, y: areaTop - offset },
    })),
  };
}
