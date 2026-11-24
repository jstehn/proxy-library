import { describe, expect, it } from "vitest";
import { allColorCombinations, colorTestCards, printedCard } from "../testing/printed-cards";
import {
  facesOnSide,
  playtestCard,
  STRIPE_TINTS,
  stripeColors,
  stripes,
  type PlaytestDrawing,
} from "./playtest-card";
import { COST_SYMBOL_DIAMETER } from "./playtest-chrome";
import { classifyFrame } from "./playtest-layouts";
import { paragraphsOf, TEXT_SIZES, TEXT_SYMBOL_RATIO, type Measure } from "./playtest-text";
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

  it("covers about a fifth of the box (thin stripes, wide gaps, to save ink)", () => {
    const area = (points: readonly Point[]) =>
      Math.abs(
        points.reduce((sum, point, index) => {
          const next = points[(index + 1) % points.length] ?? point;
          return sum + point.x * next.y - next.x * point.y;
        }, 0),
      ) / 2;
    const covered = stripes(box, ["G"]).reduce((sum, stripe) => sum + area(stripe.points), 0);
    expect(covered / (box.width * box.height)).toBeGreaterThan(0.15);
    expect(covered / (box.width * box.height)).toBeLessThan(0.25);
  });
});

describe("paragraphsOf", () => {
  it("puts reminder text in italics", () => {
    const [paragraph] = paragraphsOf("Persist (When this dies, return it.)");
    expect(paragraph).toMatchObject({ kind: "words" });
    const fonts = paragraph?.kind === "words" ? paragraph.words.map((word) => word[0]) : [];
    expect(fonts[0]).toMatchObject({ text: "Persist", font: "regular" });
    expect(fonts[1]).toMatchObject({ text: "(When", font: "italic" });
    expect(fonts.at(-1)).toMatchObject({ text: "it.)", font: "italic" });
  });

  it("keeps a symbol and the colon after it together", () => {
    const [paragraph] = paragraphsOf("{T}: Add {G}.");
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
          const allPanels = [
            ...drawing.panels,
            ...drawing.rotatedSections.flatMap((section) => section.panels),
          ];
          const boxes = [...allPanels, ...(drawing.art === null ? [] : [drawing.art])];
          for (const box of boxes) {
            expect(inside(box, frame)).toBe(true);
            expect(inside({ x: box.x + box.width, y: box.y + box.height }, frame)).toBe(true);
          }
          for (const stripe of drawing.stripes) {
            for (const point of stripe.points) expect(inside(point, frame)).toBe(true);
          }
          const allSymbols = [
            ...drawing.symbols,
            ...drawing.rotatedSections.flatMap((section) => section.symbols),
          ];
          for (const symbol of allSymbols) expect(inside(symbol, frame)).toBe(true);
          const allSetIcons = [
            ...drawing.setIcons,
            ...drawing.rotatedSections.flatMap((section) => section.setIcons),
          ];
          for (const icon of allSetIcons) expect(inside(icon, frame)).toBe(true);
          for (const section of drawing.rotatedSections) {
            expect(inside(section.center, frame)).toBe(true);
          }
        }
      }
    }
  });

  it("runs the stripes into the bleed, and nothing else", () => {
    const bleed: Box = {
      x: frame.x - 3,
      y: frame.y - 3,
      width: frame.width + 6,
      height: frame.height + 6,
    };
    const card = printedCard({}, [{ manaCost: "{U}{R}" }]);
    const drawing = playtestCard(card, "front", frame, both, measure, bleed);
    const points = drawing.stripes.flatMap((stripe) => stripe.points);
    for (const point of points) expect(inside(point, bleed)).toBe(true);
    expect(points.some((point) => !inside(point, frame))).toBe(true);
    for (const panel of drawing.panels) expect(inside(panel, frame)).toBe(true);
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

  it("lays out adventure cards with side-by-side adventure and creature panels", () => {
    const giant = testCard("Bonecrusher");
    const drawing = playtestCard(giant, "front", frame, both, measure);
    expect(drawing.rules).toHaveLength(1);
    expect(drawing.texts.map((text) => text.text)).toContain("Bonecrusher Giant");
    expect(drawing.texts.map((text) => text.text)).toContain("Stomp");
    expect(drawing.texts.map((text) => text.text)).toContain("Instant — Adventure");
    expect(drawing.texts.map((text) => text.text)).toContain("4/3");
    // Both halves' mana costs are drawn as shadowed cost symbols.
    const costSymbols = drawing.symbols.filter((symbol) => symbol.shadow).map((s) => s.symbol);
    expect(costSymbols).toEqual(["2", "R", "1", "R"]);
  });

  it("lays out Prepare cards with the inset spell on the right and creature rules on the left", () => {
    const mage = printedCard({ colors: ["U"], layout: "prepare" }, [
      {
        name: "Prismari Apprentice",
        manaCost: "{1}{U}",
        typeLine: "Creature — Human Wizard",
        text: "When this creature enters, it becomes prepared.",
        power: "2",
        toughness: "2",
      },
      {
        name: "Quick Study",
        manaCost: "{2}{U}",
        typeLine: "Sorcery",
        text: "Draw two cards.",
        power: null,
        toughness: null,
      },
    ]);
    expect(classifyFrame(mage, facesOnSide(mage, "front"))).toBe("prepare");
    const drawing = playtestCard(mage, "front", frame, both, measure);
    const spellTitle = drawing.texts.find((text) => text.text === "Quick Study");
    const creatureRule = drawing.texts.find((text) => text.text === "prepared.");
    expect(spellTitle).toBeDefined();
    expect(creatureRule).toBeDefined();
    // Prepare puts the inset spell on the right half, opposite Adventure.
    expect((spellTitle?.x ?? 0) > frame.x + frame.width / 2).toBe(true);
    expect((creatureRule?.x ?? 0) < frame.x + frame.width / 2).toBe(true);
  });

  it("lays out split cards as two equal stacked half-cards, each with its own title and cost", () => {
    const fireIce = testCard("Fire");
    const drawing = playtestCard(fireIce, "front", frame, both, measure);
    expect(drawing.rotatedSections).toEqual([]);
    expect(drawing.texts.map((text) => text.text)).toContain("Fire");
    expect(drawing.texts.map((text) => text.text)).toContain("Ice");
    const costSymbols = drawing.symbols.filter((symbol) => symbol.shadow).map((s) => s.symbol);
    expect(costSymbols).toEqual(["1", "R", "1", "U"]);
    expect(drawing.art).not.toBeNull();
  });

  it("lays out Kamigawa flip cards with the flipped half rotated 180 degrees", () => {
    const nezumi = testCard("Nezumi");
    const drawing = playtestCard(nezumi, "front", frame, both, measure);
    expect(drawing.texts.map((text) => text.text)).toContain("Nezumi Graverobber");
    expect(drawing.texts.map((text) => text.text)).toContain("2/1");
    expect(drawing.rotatedSections).toHaveLength(1);
    const [flipped] = drawing.rotatedSections;
    expect(flipped?.texts.map((text) => text.text)).toContain("Nighteyes the Desecrator");
    expect(flipped?.texts.map((text) => text.text)).toContain("4/2");
    expect(drawing.art).not.toBeNull();
  });

  it("marks double-faced cards with a title-bar icon and a bottom hint bar for the other side", () => {
    const delver = testCard("Delver");
    const front = playtestCard(delver, "front", frame, both, measure);
    expect(front.symbols.map((symbol) => symbol.symbol)).toContain("DFC_FRONT");
    expect(front.symbols.map((symbol) => symbol.symbol)).toContain("DFC_BACK");
    expect(front.texts.some((text) => text.text.includes("Insectile Aberration"))).toBe(true);
    expect(front.texts.map((text) => text.text)).toContain("3/2");

    const back = playtestCard(delver, "back", frame, both, measure);
    expect(back.symbols.map((symbol) => symbol.symbol)).toContain("DFC_BACK");
    expect(back.symbols.map((symbol) => symbol.symbol)).toContain("DFC_FRONT");
    expect(back.texts.some((text) => text.text.includes("Delver of Secrets"))).toBe(true);

    const malakir = testCard("Malakir");
    const mdfcFront = playtestCard(malakir, "front", frame, both, measure);
    expect(mdfcFront.symbols.map((symbol) => symbol.symbol)).toContain("MDFC_FRONT");
    expect(mdfcFront.symbols.map((symbol) => symbol.symbol)).toContain("MDFC_BACK");
    expect(mdfcFront.texts.some((text) => text.text.includes("Malakir Mire"))).toBe(true);

    const mdfcBack = playtestCard(malakir, "back", frame, both, measure);
    expect(mdfcBack.symbols.map((symbol) => symbol.symbol)).toContain("MDFC_BACK");
    expect(mdfcBack.symbols.map((symbol) => symbol.symbol)).toContain("MDFC_FRONT");
    expect(mdfcBack.texts.some((text) => text.text.includes("Malakir Rebirth"))).toBe(true);
  });

  it("lays out Sagas with chapters on the left and tall art on the right, including transforming Sagas", () => {
    const fable = printedCard({ colors: ["R"], layout: "transform", doubleFaced: true }, [
      {
        name: "Fable of the Mirror-Breaker",
        manaCost: "{2}{R}",
        typeLine: "Enchantment — Saga",
        text: "I — Create a 2/2 red Goblin Shaman creature token.\nII — You may discard up to two cards. If you do, draw that many cards.\nIII — Exile this Saga, then return it to the battlefield transformed.",
        power: null,
        toughness: null,
      },
      {
        name: "Reflection of Kiki-Jiki",
        manaCost: null,
        typeLine: "Enchantment Creature — Goblin Shaman",
        text: "{1}, {T}: Create a token that's a copy of another target nonlegendary creature you control.",
        power: "2",
        toughness: "2",
      },
    ]);
    expect(classifyFrame(fable, facesOnSide(fable, "front"))).toBe("saga");
    expect(classifyFrame(fable, facesOnSide(fable, "back"))).toBe("standard");

    const front = playtestCard(fable, "front", frame, both, measure);
    expect(front.art).not.toBeNull();
    // Saga puts art on the right half of the card and still includes the DFC icon + hint bar.
    expect((front.art?.x ?? 0) > frame.x + frame.width / 2).toBe(true);
    expect(front.symbols.map((symbol) => symbol.symbol)).toContain("DFC_FRONT");
    expect(front.texts.some((text) => text.text.includes("Reflection of Kiki-Jiki"))).toBe(true);
  });

  it("lays out Classes and Cases with tall art on the left and level text on the right", () => {
    const rangerClass = printedCard({ colors: ["G"], layout: "class" }, [
      {
        name: "Ranger Class",
        manaCost: "{1}{G}",
        typeLine: "Enchantment — Class",
        text: "When Ranger Class enters, create a 2/2 green Wolf creature token.\n{1}{G}: Level 2",
        power: null,
        toughness: null,
      },
    ]);
    expect(classifyFrame(rangerClass, facesOnSide(rangerClass, "front"))).toBe("class");
    const drawing = playtestCard(rangerClass, "front", frame, both, measure);
    expect(drawing.art).not.toBeNull();
    expect((drawing.art?.x ?? 0) + (drawing.art?.width ?? 0)).toBeLessThan(
      frame.x + frame.width / 2,
    );
  });

  it("prints loyalty in the corner, and no stripes or art when they're off", () => {
    const liliana = testCard("Liliana");
    const drawing = playtestCard(liliana, "front", frame, { art: false, stripes: false }, measure);
    expect(drawing.texts.map((text) => text.text)).toContain("3");
    expect(drawing.stripes).toEqual([]);
    expect(drawing.art).toBeNull();
  });
});

describe("playtest tokens (design doc 25)", () => {
  const style = { art: true, stripes: true };
  const goblin = printedCard({ isToken: true, layout: "token", colors: ["R"] }, [
    { name: "Goblin", manaCost: null, typeLine: "Token Creature — Goblin", text: "" },
  ]);
  const treasure = printedCard({ isToken: true, layout: "token" }, [
    {
      name: "Treasure",
      manaCost: null,
      typeLine: "Token Artifact — Treasure",
      text: "{T}, Sacrifice this token: Add one mana of any color.",
      power: null,
      toughness: null,
    },
  ]);
  const emblem = printedCard({ isToken: true, layout: "emblem" }, [
    {
      name: "Elspeth, Knight-Errant Emblem",
      manaCost: null,
      typeLine: "Emblem — Elspeth",
      text: "Artifacts, creatures, enchantments, and lands you control have indestructible.",
      power: null,
      toughness: null,
    },
  ]);
  const monarch = printedCard({ isToken: true, layout: "normal" }, [
    {
      name: "The Monarch",
      manaCost: null,
      typeLine: "Conspiracy",
      text: "At the beginning of the monarch's end step, that player draws a card.",
      power: null,
      toughness: null,
    },
  ]);
  const incubator = printedCard(
    { isToken: true, layout: "double_faced_token", doubleFaced: true },
    [
      {
        name: "Incubator",
        manaCost: null,
        typeLine: "Token Artifact — Incubator",
        text: "{2}: Transform this token.",
        power: null,
        toughness: null,
      },
      {
        name: "Phyrexian",
        manaCost: null,
        typeLine: "Token Artifact Creature — Phyrexian",
        text: "",
        power: "0",
        toughness: "0",
      },
    ],
  );
  const card = printedCard({}, [{ text: "" }]);

  it("gives a token without text art down to its type line, a TOKEN badge, and no text box", () => {
    const drawing = playtestCard(goblin, "front", frame, style, measure);
    const cardDrawing = playtestCard(card, "front", frame, style, measure);
    expect(drawing.art?.height).toBeGreaterThan((cardDrawing.art?.height ?? 0) + 60);
    // Title, badge pill, type line and the stats box: no text box.
    expect(drawing.panels).toHaveLength(4);
    expect(drawing.texts.map((text) => text.text)).toContain("TOKEN");
    expect(cardDrawing.panels).toHaveLength(4);
  });

  it("gives emblems and helpers their own badge", () => {
    const emblemDrawing = playtestCard(emblem, "front", frame, style, measure);
    expect(emblemDrawing.texts.map((text) => text.text)).toContain("EMBLEM");
    const helperDrawing = playtestCard(monarch, "front", frame, style, measure);
    expect(helperDrawing.texts.map((text) => text.text)).toContain("HELPER");
  });

  it("gives a double-faced token both its TOKEN badge and DFC icon + hint bar", () => {
    const front = playtestCard(incubator, "front", frame, style, measure);
    expect(front.texts.map((text) => text.text)).toContain("TOKEN");
    expect(front.symbols.map((symbol) => symbol.symbol)).toContain("DFC_FRONT");
    expect(front.symbols.map((symbol) => symbol.symbol)).toContain("DFC_BACK");
    expect(front.texts.some((text) => text.text.includes("Phyrexian"))).toBe(true);
    expect(front.texts.map((text) => text.text)).toContain("0/0");
  });

  it("gives a token with text taller art, leaving its text room at a real card's size", () => {
    const drawing = playtestCard(treasure, "front", frame, style, measure);
    const asCard = playtestCard({ ...treasure, isToken: false }, "front", frame, style, measure);
    expect(drawing.art?.height).toBeGreaterThan(asCard.art?.height ?? 0);
    // Title, badge pill, type line and text box (a Treasure has no stats).
    expect(drawing.panels).toHaveLength(4);
    const ruleTexts = drawing.texts.filter((text) => text.font === "regular" && text.size > 6);
    expect(ruleTexts.length).toBeGreaterThan(0);
    for (const text of ruleTexts) expect(text.size).toBeGreaterThanOrEqual(7.5);
  });

  it("omits the empty text box for a textless token even when art is off", () => {
    const noArt = { art: false, stripes: true };
    const drawing = playtestCard(goblin, "front", frame, noArt, measure);
    expect(drawing.art).toBeNull();
    // Title, badge pill, type line and stats box: no empty text box.
    expect(drawing.panels).toHaveLength(4);
  });

  it("draws nothing outside the card", () => {
    for (const token of [goblin, treasure, emblem, monarch, incubator]) {
      for (const side of ["front", "back"] as const) {
        const drawing = playtestCard(token, side, frame, style, measure);
        for (const box of [...drawing.panels, ...(drawing.art === null ? [] : [drawing.art])]) {
          expect(inside(box, frame)).toBe(true);
          expect(inside({ x: box.x + box.width, y: box.y + box.height }, frame)).toBe(true);
        }
      }
    }
  });

  it("stripes a token in its own colours, and a colourless one grey", () => {
    expect(stripeColors(goblin, "front")).toEqual(["R"]);
    expect(stripeColors(treasure, "front")).toEqual([]);
  });
});
