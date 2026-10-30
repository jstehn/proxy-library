import type { Board } from "./deck";
import type { PrintedCard } from "./playtest-card";

// Proxy sheets (design doc 14, section 3): which cards to print and where each one goes on the
// page. Pure, so every position can be unit-tested; drawing the PDF is infrastructure's job.
//
// Units are PDF points (72 per inch) and, as in PDF, the origin is the page's bottom-left corner.

export const POINTS_PER_INCH = 72;
export const POINTS_PER_MILLIMETER = POINTS_PER_INCH / 25.4;

/** A real Magic card: 2.5 × 3.5 inches (63.5 × 88.9 mm). */
export const CARD_WIDTH = 2.5 * POINTS_PER_INCH;
export const CARD_HEIGHT = 3.5 * POINTS_PER_INCH;
/** Home printers can't print right to the edge: nothing goes closer than 1/8 inch. */
export const PAGE_MARGIN = POINTS_PER_INCH / 8;
/** How far a corner mark reaches past the bleed at the sheet's edges. */
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
  /**
   * Bleed: none, or each card's image extended to the middle of the gap around it (and into the
   * page margin at the sheet's edges), so a slightly-off cut shows no white. The grid never
   * changes for it (changed 2026-10-07; it used to add 1/8 inch and fit fewer cards).
   */
  bleed: "none" | "fillGap";
  guides: "corners" | "lines" | "none";
  copies: "deck" | "one";
  /** Foils mixed in with the rest, or on their own pages (to print on foil paper). */
  foils: "mixed" | "ownPages";
  /** Each card's scan, or a low-ink card drawn from its text (design doc 22). */
  style: "scan" | "playtest";
  /** Playtest only: the art as it is, in shades of grey, as edges only (Sobel), or none. */
  artFilter: "color" | "grayscale" | "edges" | "none";
  /** Playtest only: stripes in the card's colours behind the frame. */
  stripes: "on" | "off";
  /** Print every copy, or only the copies your real cards don't cover (design doc 16). */
  realCards: "print" | "leaveOut";
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
  foils: "mixed",
  // Design doc 22, decision 1: scans stay the default; playtest defaults to colour art and stripes.
  style: "scan",
  artFilter: "color",
  stripes: "on",
  // Proxies stand in for cards you don't have, so real copies are left out (design doc 16).
  realCards: "leaveOut",
};

/** What the sheet needs to know about one deck line. */
export type ProxyLine = Readonly<{
  /** The card (any printing), so real copies count across printings and boards. */
  oracleId: string;
  printingId: string;
  name: string;
  quantity: number;
  board: Board;
  isBasicLand: boolean;
  /** Whether the printing has a back face with its own image (double-faced cards). */
  hasBack: boolean;
  /** Whether the deck's copy is foil (foil or etched): the line's finish. */
  isFoil: boolean;
  /** The printing's text, for playtest proxies. */
  printed: PrintedCard;
  /** Real copies of this card the deck counts (the same number on each of its lines). */
  ownedReal: number;
}>;

/** One copy to print. */
export type ProxyCard = Readonly<{
  printingId: string;
  name: string;
  hasBack: boolean;
  isFoil: boolean;
  printed: PrintedCard;
}>;

/**
 * The copies to print, in deck order, following the options. Leaving out real cards takes them
 * off by card, across its lines: a deck needing 4 Bolts when you have 2 real prints 2.
 */
export function cardsToPrint(lines: readonly ProxyLine[], options: ProxyOptions): ProxyCard[] {
  const realLeft = new Map(lines.map((line) => [line.oracleId, line.ownedReal]));
  return lines
    .filter((line) => options.basicLands === "include" || !line.isBasicLand)
    .filter((line) => options.cards === "all" || line.board !== "side")
    .flatMap((line) => {
      const wanted = options.copies === "one" ? 1 : line.quantity;
      const covered =
        options.realCards === "leaveOut" ? Math.min(wanted, realLeft.get(line.oracleId) ?? 0) : 0;
      realLeft.set(line.oracleId, (realLeft.get(line.oracleId) ?? 0) - covered);
      const copies = wanted - covered;
      const card: ProxyCard = {
        printingId: line.printingId,
        name: line.name,
        hasBack: line.hasBack && options.backFaces === "pages",
        isFoil: line.isFoil,
        printed: line.printed,
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
  printed: PrintedCard;
}>;

export type ProxyPage = Readonly<{
  width: number;
  height: number;
  /** "back" pages hold only back faces, mirrored to line up with the page before. */
  side: "front" | "back";
  /** Whether this page is for foil paper (only when foils get their own pages). */
  foil: boolean;
  placements: Placement[];
  /** Cut guides, drawn on top in grey; they never cross a card's face. */
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
 * The grid with the most cards per page: upright, or sideways when that fits more. Bleed
 * doesn't count: it only uses the gaps and margins.
 */
export function sheetGrid(options: ProxyOptions): SheetGrid {
  const paper = PAPER_SIZES[options.paper];
  const gap = options.gapMillimeters * POINTS_PER_MILLIMETER;
  const upright = {
    width: paper.width,
    height: paper.height,
    columns: fitting(paper.width, CARD_WIDTH, gap),
    rows: fitting(paper.height, CARD_HEIGHT, gap),
  };
  const sideways = {
    width: paper.height,
    height: paper.width,
    columns: fitting(paper.height, CARD_WIDTH, gap),
    rows: fitting(paper.width, CARD_HEIGHT, gap),
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
  const gap = options.gapMillimeters * POINTS_PER_MILLIMETER;
  // Bleed fills half the gap on each side, so neighbours' images meet in the middle.
  const bleed = options.bleed === "fillGap" ? gap / 2 : 0;
  // The grid is centered on the page.
  const gridWidth = grid.columns * CARD_WIDTH + (grid.columns - 1) * gap;
  const gridHeight = grid.rows * CARD_HEIGHT + (grid.rows - 1) * gap;
  const left = (grid.width - gridWidth) / 2;
  const top = (grid.height + gridHeight) / 2;
  // At the sheet's edges, bleed goes into the page margin, but never closer than PAGE_MARGIN
  // to the paper's edge.
  const outerX = Math.max(0, Math.min(bleed, left - PAGE_MARGIN));
  const outerY = Math.max(0, Math.min(bleed, grid.height - top - PAGE_MARGIN));

  function placement(card: ProxyCard, index: number, face: "front" | "back"): Placement {
    const row = Math.floor(index / grid.columns);
    const frontColumn = index % grid.columns;
    const column = face === "front" ? frontColumn : grid.columns - 1 - frontColumn;
    const cardBox: Box = {
      x: left + column * (CARD_WIDTH + gap),
      y: top - row * (CARD_HEIGHT + gap) - CARD_HEIGHT,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    };
    const leftBleed = column === 0 ? outerX : bleed;
    const rightBleed = column === grid.columns - 1 ? outerX : bleed;
    const topBleed = row === 0 ? outerY : bleed;
    const bottomBleed = row === grid.rows - 1 ? outerY : bleed;
    const image: Box = {
      x: cardBox.x - leftBleed,
      y: cardBox.y - bottomBleed,
      width: CARD_WIDTH + leftBleed + rightBleed,
      height: CARD_HEIGHT + topBleed + bottomBleed,
    };
    return {
      printingId: card.printingId,
      name: card.name,
      face,
      card: cardBox,
      image,
      printed: card.printed,
    };
  }

  function page(side: "front" | "back", foil: boolean, placements: Placement[]): ProxyPage {
    return {
      width: grid.width,
      height: grid.height,
      side,
      foil,
      placements,
      guides: guidesFor(placements, options.guides, gap, grid),
    };
  }

  /** One group's pages: single-faced cards, then double-faced fronts each followed by backs. */
  function pagesFor(group: readonly ProxyCard[], foil: boolean): ProxyPage[] {
    const singles = group.filter((card) => !card.hasBack);
    const doubles = group.filter((card) => card.hasBack);
    return [
      ...chunks(singles, perPage).map((cardsOnPage) =>
        page(
          "front",
          foil,
          cardsOnPage.map((card, index) => placement(card, index, "front")),
        ),
      ),
      ...chunks(doubles, perPage).flatMap((cardsOnPage) => [
        page(
          "front",
          foil,
          cardsOnPage.map((card, index) => placement(card, index, "front")),
        ),
        page(
          "back",
          foil,
          cardsOnPage.map((card, index) => placement(card, index, "back")),
        ),
      ]),
    ];
  }

  // Foils on their own pages come last, so the foil paper goes in once, at the end.
  if (options.foils === "mixed") return pagesFor(cards, false);
  return [
    ...pagesFor(
      cards.filter((card) => !card.isFoil),
      false,
    ),
    ...pagesFor(
      cards.filter((card) => card.isFoil),
      true,
    ),
  ];
}

/**
 * The cut guides for the cards on one page, drawn on top of everything in grey. Corner marks
 * belong to each card: they start at its real-size corners and run outwards along its edges over
 * its own bleed (or, with bleed off, the space its bleed would use: half the gap), so neighbours'
 * marks meet in the middle and never cross a card. At the sheet's edges they go on past the
 * bleed by MARK_LENGTH, so they show in the margin.
 */
function guidesFor(
  placements: readonly Placement[],
  style: ProxyOptions["guides"],
  gap: number,
  page: { width: number; height: number },
): GuideLine[] {
  if (style === "none") return [];
  if (style === "lines") {
    // A line across the whole page along every card edge: cut from edge to edge. Cards in a row
    // or column share their edges, so a line only ever runs along a card's edge.
    const xs = new Set(placements.flatMap(({ card }) => [card.x, card.x + card.width]));
    const ys = new Set(placements.flatMap(({ card }) => [card.y, card.y + card.height]));
    return [
      ...[...xs].map((x) => ({ from: { x, y: 0 }, to: { x, y: page.height } })),
      ...[...ys].map((y) => ({ from: { x: 0, y }, to: { x: page.width, y } })),
    ];
  }
  const near = (one: number, other: number) => Math.abs(one - other) < 0.01;
  /** Whether a card sits next to this one, `columns` across and `rows` up. */
  function hasNeighbour(card: Box, columns: number, rows: number): boolean {
    return placements.some(
      (other) =>
        near(other.card.x, card.x + columns * (card.width + gap)) &&
        near(other.card.y, card.y + rows * (card.height + gap)),
    );
  }
  return placements.flatMap(({ card, image }) => {
    const right = card.x + card.width;
    const top = card.y + card.height;
    // This card's own bleed on each side (zero when bleed is off).
    const bleed = {
      left: card.x - image.x,
      right: image.x + image.width - right,
      down: card.y - image.y,
      up: image.y + image.height - top,
    };
    /** How far a mark runs on one side: over the card's bleed, or past it at the sheet's edge. */
    const reach = (side: keyof typeof bleed, columns: number, rows: number) =>
      hasNeighbour(card, columns, rows)
        ? bleed[side] > 0
          ? bleed[side]
          : gap / 2
        : bleed[side] + MARK_LENGTH;
    const left = reach("left", -1, 0);
    const rightward = reach("right", 1, 0);
    const down = reach("down", 0, -1);
    const up = reach("up", 0, 1);
    const corners = [
      { x: card.x, y: card.y, across: -left, along: -down },
      { x: right, y: card.y, across: rightward, along: -down },
      { x: card.x, y: top, across: -left, along: up },
      { x: right, y: top, across: rightward, along: up },
    ];
    return corners.flatMap((corner) => [
      ...(corner.across === 0
        ? []
        : [
            {
              from: { x: corner.x, y: corner.y },
              to: { x: corner.x + corner.across, y: corner.y },
            },
          ]),
      ...(corner.along === 0
        ? []
        : [
            { from: { x: corner.x, y: corner.y }, to: { x: corner.x, y: corner.y + corner.along } },
          ]),
    ]);
  });
}

/** A short description for the options form: how many cards, on how many pages. */
export type ProxySummary = Readonly<{
  cards: number;
  pages: number;
  /** Page numbers (from 1) of double-faced cards' fronts and backs, to print two-sided. */
  twoSidedPages: number[];
  /** Page numbers of foils, to print on foil paper (empty unless foils get their own pages). */
  foilPages: number[];
  perPage: number;
  sideways: boolean;
}>;

export function proxySummary(lines: readonly ProxyLine[], options: ProxyOptions): ProxySummary {
  const cards = cardsToPrint(lines, options);
  const pages = proxyPages(cards, options);
  const grid = sheetGrid(options);
  // A page is two-sided when it holds backs, or when the page after it does (its fronts).
  const twoSidedPages = pages.flatMap((page, index) =>
    page.side === "back" || pages[index + 1]?.side === "back" ? [index + 1] : [],
  );
  return {
    cards: cards.length,
    pages: pages.length,
    twoSidedPages,
    foilPages: pages.flatMap((page, index) => (page.foil ? [index + 1] : [])),
    perPage: grid.columns * grid.rows,
    sideways: grid.width > grid.height,
  };
}

/** Page numbers in words, runs joined: [2, 3, 4, 7] → "pages 2–4 and 7". */
export function pageList(pages: readonly number[]): string {
  const runs: string[] = [];
  for (let start = 0; start < pages.length;) {
    let end = start;
    while (end + 1 < pages.length && pages[end + 1] === pages[end] + 1) end++;
    runs.push(start === end ? `${pages[start]}` : `${pages[start]}–${pages[end]}`);
    start = end + 1;
  }
  const words =
    runs.length <= 1 ? runs.join("") : `${runs.slice(0, -1).join(", ")} and ${runs.at(-1)}`;
  return `${pages.length === 1 ? "page" : "pages"} ${words}`;
}

/** How the renderer finds a placement's image among the fetched ones. */
export function proxyImageKey(placement: Pick<Placement, "printingId" | "face">): string {
  return `${placement.printingId}/${placement.face}`;
}
