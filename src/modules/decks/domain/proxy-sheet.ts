import type { Board } from "./deck";

// Proxy sheets (design doc 14, section 3): which cards to print and where each one goes on the
// page. Pure, so every position can be unit-tested; drawing the PDF is infrastructure's job.
//
// Units are PDF points (72 per inch) and, as in PDF, the origin is the page's bottom-left corner.

export const POINTS_PER_INCH = 72;
export const POINTS_PER_MILLIMETER = POINTS_PER_INCH / 25.4;

/** A real Magic card: 2.5 × 3.5 inches (63.5 × 88.9 mm). */
export const CARD_WIDTH = 2.5 * POINTS_PER_INCH;
export const CARD_HEIGHT = 3.5 * POINTS_PER_INCH;
/** Extra image around each card for professional cutting: 1/8 inch. */
export const BLEED = POINTS_PER_INCH / 8;
/** Home printers can't print right to the edge: nothing goes closer than 1/8 inch. */
export const PAGE_MARGIN = POINTS_PER_INCH / 8;
/** How far a corner mark reaches beyond the card (and its bleed). */
export const MARK_LENGTH = 3 * POINTS_PER_MILLIMETER;

export const PAPER_SIZES = {
  letter: { width: 8.5 * POINTS_PER_INCH, height: 11 * POINTS_PER_INCH },
  a4: { width: 210 * POINTS_PER_MILLIMETER, height: 297 * POINTS_PER_MILLIMETER },
} as const;
export type Paper = keyof typeof PAPER_SIZES;

export const GAPS_IN_MILLIMETERS = [0, 1, 2, 3] as const;

export type ProxyOptions = Readonly<{
  paper: Paper;
  basicLands: "skip" | "include";
  /** Back faces on their own (mirrored) pages, or fronts only. */
  backFaces: "pages" | "skip";
  cards: "all" | "noSideboard";
  gapMillimeters: (typeof GAPS_IN_MILLIMETERS)[number];
  bleed: "none" | "eighthInch";
  guides: "corners" | "lines" | "none";
  copies: "deck" | "one";
}>;

/** The defaults agreed in design doc 14 (section 3 and decision 4). */
export const DEFAULT_PROXY_OPTIONS: ProxyOptions = {
  paper: "letter",
  basicLands: "skip",
  backFaces: "pages",
  cards: "all",
  gapMillimeters: 2,
  bleed: "none",
  guides: "corners",
  copies: "deck",
};

/** What the sheet needs to know about one deck line. */
export type ProxyLine = Readonly<{
  printingId: string;
  name: string;
  quantity: number;
  board: Board;
  isBasicLand: boolean;
  /** Whether the printing has a back face with its own image (double-faced cards). */
  hasBack: boolean;
}>;

/** One copy to print. */
export type ProxyCard = Readonly<{ printingId: string; name: string; hasBack: boolean }>;

/** The copies to print, in deck order, following the options. */
export function cardsToPrint(lines: readonly ProxyLine[], options: ProxyOptions): ProxyCard[] {
  return lines
    .filter((line) => options.basicLands === "include" || !line.isBasicLand)
    .filter((line) => options.cards === "all" || line.board !== "side")
    .flatMap((line) => {
      const copies = options.copies === "one" ? 1 : line.quantity;
      const card: ProxyCard = {
        printingId: line.printingId,
        name: line.name,
        hasBack: line.hasBack && options.backFaces === "pages",
      };
      return Array.from({ length: copies }, () => card);
    });
}

export type Box = Readonly<{ x: number; y: number; width: number; height: number }>;
export type Point = Readonly<{ x: number; y: number }>;
export type GuideLine = Readonly<{ from: Point; to: Point }>;

export type Placement = Readonly<{
  printingId: string;
  name: string;
  face: "front" | "back";
  /** Where the card itself goes: the cut lines. */
  card: Box;
  /** Where the image is drawn: the card, plus the bleed around it when there is one. */
  image: Box;
}>;

export type ProxyPage = Readonly<{
  width: number;
  height: number;
  /** "back" pages hold only back faces, mirrored to line up with the page before. */
  side: "front" | "back";
  placements: Placement[];
  /** Cut guides, drawn underneath the cards so they only show between and around them. */
  guides: GuideLine[];
}>;

/** How the cards sit on a sheet: the page size (maybe turned sideways) and the grid. */
export type SheetGrid = Readonly<{
  width: number;
  height: number;
  columns: number;
  rows: number;
}>;

/** How many slots of `slot` size, `gap` apart, fit in `length` inside the margins. */
function fitting(length: number, slot: number, gap: number): number {
  return Math.max(0, Math.floor((length - 2 * PAGE_MARGIN + gap) / (slot + gap)));
}

/**
 * The grid with the most cards per page: upright, or sideways when that fits more (with bleed,
 * 3 × 3 no longer fits on Letter or A4).
 */
export function sheetGrid(options: ProxyOptions): SheetGrid {
  const paper = PAPER_SIZES[options.paper];
  const bleed = options.bleed === "eighthInch" ? BLEED : 0;
  const gap = options.gapMillimeters * POINTS_PER_MILLIMETER;
  const slotWidth = CARD_WIDTH + 2 * bleed;
  const slotHeight = CARD_HEIGHT + 2 * bleed;
  const upright = {
    width: paper.width,
    height: paper.height,
    columns: fitting(paper.width, slotWidth, gap),
    rows: fitting(paper.height, slotHeight, gap),
  };
  const sideways = {
    width: paper.height,
    height: paper.width,
    columns: fitting(paper.height, slotWidth, gap),
    rows: fitting(paper.width, slotHeight, gap),
  };
  return sideways.columns * sideways.rows > upright.columns * upright.rows ? sideways : upright;
}

/** Splits a list into pieces of `size`. */
function chunks<T>(items: readonly T[], size: number): T[][] {
  const pieces: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    pieces.push(items.slice(start, start + size));
  }
  return pieces;
}

/**
 * Every page of the sheet. Single-faced cards come first; then the double-faced ones, each page
 * of fronts followed by a page of their backs in mirrored columns (flip the sheet left to right
 * and each back lands behind its front).
 */
export function proxyPages(cards: readonly ProxyCard[], options: ProxyOptions): ProxyPage[] {
  const grid = sheetGrid(options);
  const perPage = grid.columns * grid.rows;
  if (perPage === 0) return [];
  const bleed = options.bleed === "eighthInch" ? BLEED : 0;
  const gap = options.gapMillimeters * POINTS_PER_MILLIMETER;
  const slotWidth = CARD_WIDTH + 2 * bleed;
  const slotHeight = CARD_HEIGHT + 2 * bleed;
  // The grid is centered on the page.
  const gridWidth = grid.columns * slotWidth + (grid.columns - 1) * gap;
  const gridHeight = grid.rows * slotHeight + (grid.rows - 1) * gap;
  const left = (grid.width - gridWidth) / 2;
  const top = (grid.height + gridHeight) / 2;

  function placement(card: ProxyCard, index: number, face: "front" | "back"): Placement {
    const row = Math.floor(index / grid.columns);
    const frontColumn = index % grid.columns;
    const column = face === "front" ? frontColumn : grid.columns - 1 - frontColumn;
    const image: Box = {
      x: left + column * (slotWidth + gap),
      y: top - row * (slotHeight + gap) - slotHeight,
      width: slotWidth,
      height: slotHeight,
    };
    const cardBox: Box = {
      x: image.x + bleed,
      y: image.y + bleed,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    };
    return { printingId: card.printingId, name: card.name, face, card: cardBox, image };
  }

  function page(side: "front" | "back", placements: Placement[]): ProxyPage {
    return {
      width: grid.width,
      height: grid.height,
      side,
      placements,
      guides: guidesFor(placements, options.guides, bleed, grid),
    };
  }

  const singles = cards.filter((card) => !card.hasBack);
  const doubles = cards.filter((card) => card.hasBack);
  return [
    ...chunks(singles, perPage).map((group) =>
      page(
        "front",
        group.map((card, index) => placement(card, index, "front")),
      ),
    ),
    ...chunks(doubles, perPage).flatMap((group) => [
      page(
        "front",
        group.map((card, index) => placement(card, index, "front")),
      ),
      page(
        "back",
        group.map((card, index) => placement(card, index, "back")),
      ),
    ]),
  ];
}

/** The cut guides for the cards on one page. */
function guidesFor(
  placements: readonly Placement[],
  style: ProxyOptions["guides"],
  bleed: number,
  page: { width: number; height: number },
): GuideLine[] {
  if (style === "none") return [];
  if (style === "lines") {
    // A line across the whole page along every card edge: cut from edge to edge.
    const xs = new Set(placements.flatMap(({ card }) => [card.x, card.x + card.width]));
    const ys = new Set(placements.flatMap(({ card }) => [card.y, card.y + card.height]));
    return [
      ...[...xs].map((x) => ({ from: { x, y: 0 }, to: { x, y: page.height } })),
      ...[...ys].map((y) => ({ from: { x: 0, y }, to: { x: page.width, y } })),
    ];
  }
  // Corner marks: from each corner, outwards along both edges. The part under the card's own
  // bleed (and any neighbor) is covered when the cards are drawn on top.
  const reach = bleed + MARK_LENGTH;
  return placements.flatMap(({ card }) => {
    const right = card.x + card.width;
    const top = card.y + card.height;
    const corners = [
      { x: card.x, y: card.y, outX: -1, outY: -1 },
      { x: right, y: card.y, outX: 1, outY: -1 },
      { x: card.x, y: top, outX: -1, outY: 1 },
      { x: right, y: top, outX: 1, outY: 1 },
    ];
    return corners.flatMap((corner) => [
      {
        from: { x: corner.x, y: corner.y },
        to: { x: corner.x + corner.outX * reach, y: corner.y },
      },
      {
        from: { x: corner.x, y: corner.y },
        to: { x: corner.x, y: corner.y + corner.outY * reach },
      },
    ]);
  });
}

/** A short description for the options form: how many cards, on how many pages. */
export type ProxySummary = Readonly<{
  cards: number;
  pages: number;
  /** Pages of double-faced cards (fronts and backs), to print two-sided. */
  twoSidedPages: number;
  perPage: number;
  sideways: boolean;
}>;

export function proxySummary(lines: readonly ProxyLine[], options: ProxyOptions): ProxySummary {
  const cards = cardsToPrint(lines, options);
  const pages = proxyPages(cards, options);
  const grid = sheetGrid(options);
  const doubles = cards.filter((card) => card.hasBack).length;
  const perPage = grid.columns * grid.rows;
  return {
    cards: cards.length,
    pages: pages.length,
    twoSidedPages: perPage === 0 ? 0 : 2 * Math.ceil(doubles / perPage),
    perPage,
    sideways: grid.width > grid.height,
  };
}

/** How the renderer finds a placement's image among the fetched ones. */
export function proxyImageKey(placement: Pick<Placement, "printingId" | "face">): string {
  return `${placement.printingId}/${placement.face}`;
}
