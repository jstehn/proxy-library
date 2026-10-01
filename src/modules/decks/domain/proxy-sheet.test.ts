import { describe, expect, it } from "vitest";
import {
  BLEED,
  CARD_HEIGHT,
  CARD_WIDTH,
  cardsToPrint,
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

const options = (changes: Partial<ProxyOptions> = {}): ProxyOptions => ({
  ...DEFAULT_PROXY_OPTIONS,
  ...changes,
});

const line = (name: string, changes: Partial<ProxyLine> = {}): ProxyLine => ({
  printingId: `id-${name}`,
  name,
  quantity: 1,
  board: "main",
  isBasicLand: false,
  hasBack: false,
  isFoil: false,
  ...changes,
});

const singles = (count: number): ProxyCard[] =>
  Array.from({ length: count }, (_, index) => ({
    printingId: `card-${index}`,
    name: `Card ${index}`,
    hasBack: false,
    isFoil: false,
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

  it("turns the page sideways when bleed makes 3 × 3 too big", () => {
    const grid = sheetGrid(options({ bleed: "eighthInch" }));
    expect(grid).toMatchObject({ columns: 3, rows: 2, width: 792, height: 612 });
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

  it("draws bleed as extra image around each card, without the images overlapping", () => {
    const [page] = proxyPages(singles(6), options({ bleed: "eighthInch", gapMillimeters: 0 }));
    const { card, image } = page.placements[0];
    expect(image).toEqual({
      x: card.x - BLEED,
      y: card.y - BLEED,
      width: CARD_WIDTH + 2 * BLEED,
      height: CARD_HEIGHT + 2 * BLEED,
    });
    const images = page.placements.map((placement) => placement.image);
    for (const [index, one] of images.entries()) {
      for (const other of images.slice(index + 1)) expect(overlaps(one, other)).toBe(false);
    }
  });

  it("puts double-faced cards last, each page of fronts followed by their mirrored backs", () => {
    const cards: ProxyCard[] = [
      ...singles(2),
      { printingId: "delver", name: "Delver of Secrets", hasBack: true, isFoil: false },
      { printingId: "huntmaster", name: "Huntmaster of the Fells", hasBack: true, isFoil: false },
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

  it("draws corner marks only outside the cards", () => {
    for (const bleed of ["none", "eighthInch"] as const) {
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
    expect(proxySummary(deck, DEFAULT_PROXY_OPTIONS)).toEqual({
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
    expect(proxySummary(deck, foilOptions)).toMatchObject({
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
