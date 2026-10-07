import { describe, expect, it } from "vitest";
import {
  allColorCombinations,
  colorTestCards,
  printedCard,
  printedFace,
} from "../testing/printed-cards";
import {
  COST_SYMBOL_DIAMETER,
  facesOnSide,
  playtestCard,
  STRIPE_TINTS,
  stripeColors,
  stripes,
  TEXT_SIZES,
  TEXT_SYMBOL_RATIO,
  textBoxParagraphs,
  type Measure,
  type PlaytestDrawing,
} from "./playtest-card";
import { CARD_HEIGHT, CARD_WIDTH, type Box, type Point } from "./proxy-sheet";

/** Every character half as wide as the text is tall: close enough to Helvetica for layout tests. */
const measure: Measure = (text, _font, size) => text.length * size * 0.5;

/** The test card whose name starts with this (it's a test bug if there's none). */
function testCard(start: string) {
  const found = colorTestCards().find((card) => card.name.startsWith(start));
  if (found === undefined) throw new Error(`no test card named ${start}…`);
  return found.printed;
}

const frame: Box = { x: 100, y: 200, width: CARD_WIDTH, height: CARD_HEIGHT };
const both = { art: true, stripes: true };

function inside(point: Point, box: Box): boolean {
  const tolerance = 1e-6;
  return (
    point.x >= box.x - tolerance &&
    point.x <= box.x + box.width + tolerance &&
    point.y >= box.y - tolerance &&
    point.y <= box.y + box.height + tolerance
  );
}

/** The rules text's size: the size of the text drawn below the type line. */
function textSizes(drawing: PlaytestDrawing): number[] {
  const textBox = drawing.panels[drawing.panels.length - 1];
  return drawing.texts
    .filter((text) => textBox !== undefined && inside({ x: text.x, y: text.y }, textBox))
    .map((text) => text.size);
}

describe("facesOnSide", () => {
  it("prints both halves of a split card on one side", () => {
    const split = printedCard({}, [{ name: "Fire" }, { name: "Ice" }]);
    expect(facesOnSide(split, "front").map((face) => face.name)).toEqual(["Fire", "Ice"]);
  });

  it("prints one face per side of a double-faced card", () => {
    const delver = printedCard({ doubleFaced: true }, [{ name: "Delver" }, { name: "Aberration" }]);
    expect(facesOnSide(delver, "front").map((face) => face.name)).toEqual(["Delver"]);
    expect(facesOnSide(delver, "back").map((face) => face.name)).toEqual(["Aberration"]);
  });
});

describe("stripeColors", () => {
  it("shows exactly the colours of the cost, for every one of the 32 combinations", () => {
    for (const colors of allColorCombinations()) {
      const cost = `{2}${colors.map((color) => `{${color}}`).join("")}`;
      const card = printedCard({ colors: ["W"] }, [{ manaCost: cost }]);
      // A cost with colours wins over the printing's colours; a colourless cost falls back to them.
      expect(stripeColors(card, "front")).toEqual(colors.length === 0 ? ["W"] : colors);
    }
  });

  it("shows both halves of split and hybrid costs", () => {
    const fireIce = printedCard({ colors: ["R"] }, [
      { manaCost: "{1}{R}" },
      { manaCost: "{1}{U}" },
    ]);
    expect(stripeColors(fireIce, "front")).toEqual(["U", "R"]);
    expect(stripeColors(printedCard({}, [{ manaCost: "{1}{G/W}{G/W}" }]), "front")).toEqual([
      "W",
      "G",
    ]);
  });

  it("shows a land's mana colours, and nothing for colourless", () => {
    const land = (producedMana: string[]) =>
      printedCard({ producedMana }, [{ manaCost: null, typeLine: "Land — Plains Island" }]);
    expect(stripeColors(land(["U", "W"]), "front")).toEqual(["W", "U"]);
    expect(stripeColors(land(["C"]), "front")).toEqual([]);
    const solRing = printedCard({ producedMana: ["C"] }, [
      { manaCost: "{1}", typeLine: "Artifact" },
    ]);
    expect(stripeColors(solRing, "front")).toEqual([]);
  });

  it("uses the printing's colours for a back face without a cost", () => {
    const delver = printedCard({ colors: ["U"], doubleFaced: true }, [
      { manaCost: "{U}" },
      { manaCost: null },
    ]);
    expect(stripeColors(delver, "back")).toEqual(["U"]);
  });

  it("has a distinct tint for every colour", () => {
    expect(new Set(Object.values(STRIPE_TINTS)).size).toBe(6);
  });
});

describe("stripes", () => {
  const box: Box = { x: 10, y: 20, width: 50, height: 70 };

  it("stays inside the box (invariant 1)", () => {
    for (const stripe of stripes(box, ["W", "U", "B"])) {
      expect(stripe.points.length).toBeGreaterThanOrEqual(3);
      for (const point of stripe.points) expect(inside(point, box)).toBe(true);
    }
  });

  it("takes the colours in turn, and is grey for colourless", () => {
    const colors = stripes(box, ["U", "R"]).map((stripe) => stripe.color);
    expect(colors.slice(0, 4)).toEqual(["U", "R", "U", "R"]);
    expect(new Set(stripes(box, []).map((stripe) => stripe.color))).toEqual(new Set(["C"]));
  });

  it("covers about half the box (a white gap between stripes)", () => {
    const area = (points: readonly Point[]) =>
      Math.abs(
        points.reduce((sum, point, index) => {
          const next = points[(index + 1) % points.length] ?? point;
          return sum + point.x * next.y - next.x * point.y;
        }, 0),
      ) / 2;
    const covered = stripes(box, ["G"]).reduce((sum, stripe) => sum + area(stripe.points), 0);
    expect(covered / (box.width * box.height)).toBeGreaterThan(0.4);
    expect(covered / (box.width * box.height)).toBeLessThan(0.6);
  });
});

describe("textBoxParagraphs", () => {
  it("puts reminder text in italics", () => {
    const [paragraph] = textBoxParagraphs([
      { ...printedFace(), text: "Persist (When this dies, return it.)" },
    ]);
    expect(paragraph).toMatchObject({ kind: "words" });
    const fonts = paragraph?.kind === "words" ? paragraph.words.map((word) => word[0]) : [];
    expect(fonts[0]).toMatchObject({ text: "Persist", font: "regular" });
    expect(fonts[1]).toMatchObject({ text: "(When", font: "italic" });
    expect(fonts.at(-1)).toMatchObject({ text: "it.)", font: "italic" });
  });

  it("keeps a symbol and the colon after it together", () => {
    const [paragraph] = textBoxParagraphs([{ ...printedFace(), text: "{T}: Add {G}." }]);
    expect(paragraph?.kind === "words" ? paragraph.words[0] : null).toEqual([
      { kind: "symbol", symbol: "T" },
      { kind: "text", text: ":", font: "regular" },
    ]);
  });
});

describe("playtestCard", () => {
  it("draws nothing outside the card, for every test card, with and without art", () => {
    for (const { printed } of colorTestCards()) {
      for (const art of [true, false]) {
        for (const side of ["front", "back"] as const) {
          const drawing = playtestCard(printed, side, frame, { art, stripes: true }, measure);
          const boxes = [...drawing.panels, ...(drawing.art === null ? [] : [drawing.art])];
          for (const box of boxes) {
            expect(inside(box, frame)).toBe(true);
            expect(inside({ x: box.x + box.width, y: box.y + box.height }, frame)).toBe(true);
          }
          for (const stripe of drawing.stripes) {
            for (const point of stripe.points) expect(inside(point, frame)).toBe(true);
          }
          for (const symbol of drawing.symbols) expect(inside(symbol, frame)).toBe(true);
        }
      }
    }
  });

  it("puts the mana cost on the right of the title bar at real-card size", () => {
    const card = printedCard({}, [{ name: "Kitchen Finks", manaCost: "{1}{G/W}{G/W}" }]);
    const drawing = playtestCard(card, "front", frame, both, measure);
    const cost = drawing.symbols.filter((symbol) => symbol.shadow);
    expect(cost.map((symbol) => symbol.symbol)).toEqual(["1", "G/W", "G/W"]);
    expect(COST_SYMBOL_DIAMETER).toBeCloseTo(8.5, 1); // 3.0 mm
    for (const symbol of cost) expect(symbol.diameter).toBe(COST_SYMBOL_DIAMETER);
    const xs = cost.map((symbol) => symbol.x);
    expect(xs).toEqual([...xs].sort((one, other) => one - other));
    expect((xs.at(-1) ?? 0) + COST_SYMBOL_DIAMETER / 2).toBeLessThanOrEqual(frame.x + frame.width);
  });

  it("sizes symbols in rules text to the text", () => {
    const card = printedCard({}, [{ text: "{T}: Add {G}." }]);
    const drawing = playtestCard(card, "front", frame, both, measure);
    const inText = drawing.symbols.filter((symbol) => !symbol.shadow);
    const [size] = textSizes(drawing);
    expect(inText.map((symbol) => symbol.symbol)).toEqual(["T", "G"]);
    for (const symbol of inText)
      expect(symbol.diameter).toBeCloseTo((size ?? 0) * TEXT_SYMBOL_RATIO);
  });

  it("prints short text at the largest size, and shrinks long text", () => {
    const short = playtestCard(
      printedCard({}, [{ text: "Flying" }]),
      "front",
      frame,
      both,
      measure,
    );
    expect(textSizes(short)).toEqual([TEXT_SIZES.largest]);
    const long = testCard("Atraxa");
    const drawing = playtestCard(long, "front", frame, both, measure);
    expect(Math.max(...textSizes(drawing))).toBeLessThan(TEXT_SIZES.largest);
  });

  it("takes space from the art rather than cutting text (invariant 2)", () => {
    const wall = "Lorem ipsum dolor sit amet consectetur. ".repeat(30);
    const drawing = playtestCard(printedCard({}, [{ text: wall }]), "front", frame, both, measure);
    const normal = playtestCard(
      printedCard({}, [{ text: "Flying" }]),
      "front",
      frame,
      both,
      measure,
    );
    expect((drawing.art?.height ?? 0) < (normal.art?.height ?? 0)).toBe(true);
    const textBox = drawing.panels.at(-1) ?? frame;
    const rulesText = drawing.texts.filter((text) => wall.includes(text.text));
    const lowest = Math.min(...rulesText.map((text) => text.y - text.size * 0.25));
    expect(lowest).toBeGreaterThanOrEqual(textBox.y);
  });

  it("prints the second half of split and adventure cards under a line", () => {
    const giant = testCard("Bonecrusher");
    const drawing = playtestCard(giant, "front", frame, both, measure);
    expect(drawing.rules).toHaveLength(1);
    expect(drawing.texts.map((text) => text.text)).toContain("Stomp");
    expect(drawing.texts.map((text) => text.text)).toContain("4/3");
  });

  it("prints loyalty in the corner, and no stripes or art when they're off", () => {
    const liliana = testCard("Liliana");
    const drawing = playtestCard(liliana, "front", frame, { art: false, stripes: false }, measure);
    expect(drawing.texts.map((text) => text.text)).toContain("3");
    expect(drawing.stripes).toEqual([]);
    expect(drawing.art).toBeNull();
  });
});
