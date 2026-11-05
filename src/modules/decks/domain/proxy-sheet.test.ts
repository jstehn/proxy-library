import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cardsToPrint,
  MARK_LENGTH,
  DEFAULT_PROXY_OPTIONS,
  PAGE_MARGIN,
  pageList,
  POINTS_PER_MILLIMETER,
  proxyPages,
  proxySummary,
  sheetGrid,
  type Box,
  type ProxyCard,
  type ProxyLine,
  type ProxyOptions,
} from "./proxy-sheet";
import { printedCard } from "../testing/printed-cards";

const printed = printedCard();

const options = (changes: Partial<ProxyOptions> = {}): ProxyOptions => ({
  ...DEFAULT_PROXY_OPTIONS,
  ...changes,
});

const line = (name: string, changes: Partial<ProxyLine> = {}): ProxyLine => ({
  oracleId: `oracle-${name}`,
  ownedReal: 0,
  printingId: `id-${name}`,
  name,
  quantity: 1,
  board: "main",
  isBasicLand: false,
  hasBack: false,
  isFoil: false,
  printed: printedCard(),
  ...changes,
});

const singles = (count: number): ProxyCard[] =>
  Array.from({ length: count }, (_, index) => ({
    printingId: `card-${index}`,
    name: `Card ${index}`,
    hasBack: false,
    isFoil: false,
    printed,
  }));

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("cardsToPrint", () => {
  const deck = [
    line("Lightning Bolt", { quantity: 4 }),
    line("Mountain", { quantity: 20, isBasicLand: true }),
    line("Duress", { quantity: 2, board: "side" }),
    line("Delver of Secrets", { hasBack: true }),
  ];

  it("prints every copy but skips basic lands, by default", () => {
    const cards = cardsToPrint(deck, DEFAULT_PROXY_OPTIONS);
    expect(cards.map((card) => card.name)).toEqual([
      ...Array(4).fill("Lightning Bolt"),
      "Duress",
      "Duress",
      "Delver of Secrets",
    ]);
    expect(cards.at(-1)?.hasBack).toBe(true);
  });

  it("leaves out copies your real cards cover, by card across its boards (design doc 16)", () => {
    const withReal = [
      line("Lightning Bolt", { quantity: 4, ownedReal: 2 }),
      line("Duress", { quantity: 2, ownedReal: 3, board: "main" }),
      line("Duress", { quantity: 2, ownedReal: 3, board: "side" }),
    ];
    const names = (options: ProxyOptions) =>
      cardsToPrint(withReal, options).map((card) => card.name);
    expect(names(DEFAULT_PROXY_OPTIONS)).toEqual(["Lightning Bolt", "Lightning Bolt", "Duress"]);
    expect(names(options({ realCards: "print" }))).toHaveLength(8);
    expect(names(options({ copies: "one" }))).toEqual([]);
  });

  it("follows the options: basics, one of each, no sideboard, fronts only", () => {
    const cards = cardsToPrint(
      deck,
      options({ basicLands: "include", copies: "one", cards: "noSideboard", backFaces: "skip" }),
    );
    expect(cards.map((card) => card.name)).toEqual([
      "Lightning Bolt",
      "Mountain",
      "Delver of Secrets",
    ]);
    expect(cards.every((card) => !card.hasBack)).toBe(true);
  });
});

describe("sheetGrid", () => {
  it("fits 3 × 3 real-size cards on Letter and on A4", () => {
    expect(sheetGrid(options())).toMatchObject({ columns: 3, rows: 3, width: 612, height: 792 });
    expect(sheetGrid(options({ paper: "a4" }))).toMatchObject({ columns: 3, rows: 3 });
  });

  it("keeps 3 × 3 with bleed, at every gap, on both papers", () => {
    for (const paper of ["letter", "a4"] as const) {
      for (const gapMillimeters of [0, 1, 2, 3] as const) {
        const grid = sheetGrid(options({ paper, gapMillimeters, bleed: "fillGap" }));
        expect(grid).toMatchObject({ columns: 3, rows: 3 });
      }
    }
  });
});

describe("proxyPages", () => {
  it("puts nine cards on a page, all inside the margins, the gap apart", () => {
    const pages = proxyPages(singles(11), options());
    expect(pages.map((page) => page.placements.length)).toEqual([9, 2]);
    for (const { card, image } of pages[0].placements) {
      expect(card).toMatchObject({ width: CARD_WIDTH, height: CARD_HEIGHT });
      expect(image).toEqual(card); // no bleed
      expect(card.x).toBeGreaterThanOrEqual(PAGE_MARGIN);
      expect(card.y).toBeGreaterThanOrEqual(PAGE_MARGIN);
      expect(card.x + card.width).toBeLessThanOrEqual(612 - PAGE_MARGIN);
      expect(card.y + card.height).toBeLessThanOrEqual(792 - PAGE_MARGIN);
    }
    const [first, second, , fourth] = pages[0].placements;
    expect(second.card.x - (first.card.x + CARD_WIDTH)).toBeCloseTo(2 * POINTS_PER_MILLIMETER);
    expect(first.card.y - (fourth.card.y + CARD_HEIGHT)).toBeCloseTo(2 * POINTS_PER_MILLIMETER);
    // Left to right, then top to bottom (PDF's y grows upwards).
    expect(second.card.x).toBeGreaterThan(first.card.x);
    expect(fourth.card.y).toBeLessThan(first.card.y);
  });

  it("fills the gap with bleed: images meet in the middle, cards stay where they were", () => {
    const [plain] = proxyPages(singles(9), options({ gapMillimeters: 2 }));
    const [page] = proxyPages(singles(9), options({ gapMillimeters: 2, bleed: "fillGap" }));
    const half = POINTS_PER_MILLIMETER;
    expect(page.placements.map((placement) => placement.card)).toEqual(
      plain.placements.map((placement) => placement.card),
    );
    // The middle card has a neighbour on every side: 1 mm of bleed all round.
    const middle = page.placements[4];
    expect(middle.image.x).toBeCloseTo(middle.card.x - half);
    expect(middle.image.y).toBeCloseTo(middle.card.y - half);
    expect(middle.image.width).toBeCloseTo(CARD_WIDTH + 2 * half);
    expect(middle.image.height).toBeCloseTo(CARD_HEIGHT + 2 * half);
    // Neighbours touch, never overlap.
    const [first, second] = page.placements;
    expect(first.image.x + first.image.width).toBeCloseTo(second.image.x);
    const images = page.placements.map((placement) => placement.image);
    for (const [index, one] of images.entries()) {
      for (const other of images.slice(index + 1)) {
        const shrunk = {
          x: one.x + 0.01,
          y: one.y + 0.01,
          width: one.width - 0.02,
          height: one.height - 0.02,
        };
        expect(overlaps(shrunk, other)).toBe(false);
      }
    }
  });

  it("lets bleed into the page margin at the edges, but not closer than 1/8 inch to the paper", () => {
    for (const paper of ["letter", "a4"] as const) {
      for (const gapMillimeters of [1, 2, 3] as const) {
        const grid = sheetGrid(options({ paper, gapMillimeters }));
        const [page] = proxyPages(singles(9), options({ paper, gapMillimeters, bleed: "fillGap" }));
        for (const { image } of page.placements) {
          expect(image.x).toBeGreaterThanOrEqual(PAGE_MARGIN - 1e-9);
          expect(image.y).toBeGreaterThanOrEqual(PAGE_MARGIN - 1e-9);
          expect(image.x + image.width).toBeLessThanOrEqual(grid.width - PAGE_MARGIN + 1e-9);
          expect(image.y + image.height).toBeLessThanOrEqual(grid.height - PAGE_MARGIN + 1e-9);
        }
      }
    }
  });

  it("has nothing to bleed into without a gap", () => {
    const [page] = proxyPages(singles(9), options({ gapMillimeters: 0, bleed: "fillGap" }));
    for (const { card, image } of page.placements) expect(image).toEqual(card);
  });

  it("puts double-faced cards last, each page of fronts followed by their mirrored backs", () => {
    const cards: ProxyCard[] = [
      ...singles(2),
      { printingId: "delver", name: "Delver of Secrets", hasBack: true, isFoil: false, printed },
      {
        printingId: "huntmaster",
        name: "Huntmaster of the Fells",
        hasBack: true,
        isFoil: false,
        printed,
      },
    ];
    const pages = proxyPages(cards, options());
    expect(pages.map((page) => page.side)).toEqual(["front", "front", "back"]);
    expect(pages[0].placements.map((placement) => placement.printingId)).toEqual([
      "card-0",
      "card-1",
    ]);

    const [fronts, backs] = [pages[1], pages[2]];
    expect(backs.placements.every((placement) => placement.face === "back")).toBe(true);
    for (const [index, front] of fronts.placements.entries()) {
      const back = backs.placements[index];
      expect(back.printingId).toBe(front.printingId);
      // Flipped left to right around the page's middle, at the same height.
      expect(back.card.x).toBeCloseTo(fronts.width - front.card.x - CARD_WIDTH);
      expect(back.card.y).toBe(front.card.y);
    }
  });

  it("starts each card's marks at its real-size corners and keeps them over its own bleed", () => {
    for (const bleed of ["none", "fillGap"] as const) {
      const [page] = proxyPages(singles(9), options({ bleed, gapMillimeters: 2 }));
      const halfGap = POINTS_PER_MILLIMETER; // 1 mm: the card's share of a 2 mm gap
      const middle = page.placements[4]; // a neighbour on every side
      const corners = [middle.card.x, middle.card.x + CARD_WIDTH].flatMap((x) =>
        [middle.card.y, middle.card.y + CARD_HEIGHT].map((y) => ({ x, y })),
      );
      const own = page.guides.filter((guide) =>
        corners.some((corner) => guide.from.x === corner.x && guide.from.y === corner.y),
      );
      expect(own).toHaveLength(8);
      for (const guide of own) {
        const length = Math.hypot(guide.to.x - guide.from.x, guide.to.y - guide.from.y);
        expect(length).toBeCloseTo(halfGap); // to the middle of the gap, no further
      }
    }
  });

  it("runs marks at the sheet's edges past the bleed into the margin", () => {
    const [page] = proxyPages(singles(9), options({ bleed: "fillGap", gapMillimeters: 2 }));
    const first = page.placements[0]; // top-left card
    const top = first.card.y + CARD_HEIGHT;
    const upward = page.guides.find(
      (guide) => guide.from.x === first.card.x && guide.from.y === top && guide.to.y > top,
    );
    expect(upward?.to.y).toBeCloseTo(first.image.y + first.image.height + MARK_LENGTH);
  });

  it("draws corner marks only outside the cards", () => {
    for (const bleed of ["none", "fillGap"] as const) {
      const [page] = proxyPages(singles(9), options({ bleed }));
      expect(page.guides).toHaveLength(page.placements.length * 8); // two per corner
      // A mark that reaches into a card must run along its edge, never across its face.
      for (const guide of page.guides) {
        for (const { card } of page.placements) {
          const inside = (point: { x: number; y: number }) =>
            point.x > card.x &&
            point.x < card.x + card.width &&
            point.y > card.y &&
            point.y < card.y + card.height;
          const middle = {
            x: (guide.from.x + guide.to.x) / 2,
            y: (guide.from.y + guide.to.y) / 2,
          };
          expect(inside(guide.from) || inside(guide.to) || inside(middle)).toBe(false);
        }
      }
    }
  });

  it("draws full cut lines along every card edge, or no guides at all", () => {
    const [lines] = proxyPages(singles(9), options({ guides: "lines" }));
    expect(lines.guides).toHaveLength(6 + 6); // two edges per column and per row
    const [none] = proxyPages(singles(9), options({ guides: "none" }));
    expect(none.guides).toEqual([]);
  });
});

describe("proxySummary", () => {
  it("counts cards and pages, and which pages print two-sided", () => {
    const deck = [line("Opt", { quantity: 10 }), line("Delver of Secrets", { hasBack: true })];
    expect(proxySummary(cardsToPrint(deck, DEFAULT_PROXY_OPTIONS), DEFAULT_PROXY_OPTIONS)).toEqual({
      cards: 11,
      pages: 4, // 9 + 1 singles, then Delver's front and back
      twoSidedPages: [3, 4],
      foilPages: [],
      perPage: 9,
      sideways: false,
    });
  });
});

describe("foils on their own pages", () => {
  const deck = [
    line("Opt", { quantity: 2 }),
    line("Lightning Bolt", { quantity: 3, isFoil: true }),
    line("Delver of Secrets", { hasBack: true, isFoil: true }),
    line("Ponder"),
  ];

  it("mixes foils in by default", () => {
    const pages = proxyPages(cardsToPrint(deck, DEFAULT_PROXY_OPTIONS), DEFAULT_PROXY_OPTIONS);
    expect(pages.map((page) => page.placements.length)).toEqual([6, 1, 1]);
    expect(pages.every((page) => !page.foil)).toBe(true);
  });

  it("puts every foil, double-faced ones too, on foil pages after the rest", () => {
    const foilOptions = options({ foils: "ownPages" });
    const pages = proxyPages(cardsToPrint(deck, foilOptions), foilOptions);
    const names = pages.map((page) => page.placements.map((placement) => placement.name));
    expect(names).toEqual([
      ["Opt", "Opt", "Ponder"],
      ["Lightning Bolt", "Lightning Bolt", "Lightning Bolt"],
      ["Delver of Secrets"],
      ["Delver of Secrets"],
    ]);
    expect(pages.map((page) => page.foil)).toEqual([false, true, true, true]);
    expect(proxySummary(cardsToPrint(deck, foilOptions), foilOptions)).toMatchObject({
      pages: 4,
      foilPages: [2, 3, 4],
      twoSidedPages: [3, 4],
    });
  });
});

describe("pageList", () => {
  it("joins runs of pages", () => {
    expect(pageList([4])).toBe("page 4");
    expect(pageList([2, 3, 4])).toBe("pages 2–4");
    expect(pageList([2, 3, 4, 7])).toBe("pages 2–4 and 7");
    expect(pageList([1, 3, 5, 6])).toBe("pages 1, 3 and 5–6");
  });
});
