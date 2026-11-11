import { describe, expect, it } from "vitest";
import type { BrowseCard, CardRules, DeckLine } from "@/modules/decks";
import { commanderColorsOf, problemsOf, provisionalLine } from "./derive";

const rules = (name: string, overrides: Partial<CardRules> = {}): CardRules => ({
  name,
  typeLine: "Creature — Elf",
  text: "",
  colorIdentity: [],
  legalities: { commander: "legal" },
  isBasicLand: false,
  hasPowerToughness: true,
  ...overrides,
});

const gridCard = (name: string, card: Partial<CardRules> = {}): BrowseCard => ({
  oracleId: name,
  printingId: `printing-${name}`,
  ownedReal: 0,
  isGameChanger: false,
  name,
  manaCost: "{1}{G}",
  manaValue: 2,
  typeLine: card.typeLine ?? "Creature — Elf",
  owned: 1,
  inThisDeck: 0,
  otherDecks: 0,
  free: 1,
  misfit: null,
  rules: rules(name, card),
  producedMana: [],
  text: card.text ?? "",
  setCode: "tst",
  collectorNumber: "1",
  finish: "nonfoil",
  priceCents: 25,
});

const commander = gridCard("Elf Lord", {
  typeLine: "Legendary Creature — Elf",
  colorIdentity: ["G"],
});
const offColor = gridCard("Shock", { typeLine: "Instant", colorIdentity: ["R"] });

describe("the builder's derived state (design doc 19, section 5.3)", () => {
  const lines: DeckLine[] = [provisionalLine(commander, "commander", 1)];
  const known = { [commander.oracleId]: commander.rules };

  it("takes the commander's colors from the deck in hand", () => {
    expect(commanderColorsOf("commander", lines, known)).toEqual(["G"]);
    expect(commanderColorsOf("casual", lines, known)).toBeNull();
    expect(commanderColorsOf("commander", [], known)).toBeNull();
  });

  it("marks an off-color card as soon as its provisional line is in", () => {
    const withShock = [...lines, provisionalLine(offColor, "main", 1)];
    const problems = problemsOf("commander", withShock, { ...known, Shock: offColor.rules });
    expect(problems).toContainEqual({ text: expect.stringMatching(/color/i), name: "Shock" });
  });

  it("skips lines whose rules haven't arrived instead of failing", () => {
    const withShock = [...lines, provisionalLine(offColor, "main", 1)];
    const problems = problemsOf("commander", withShock, known);
    expect(problems.some((problem) => problem.name === "Shock")).toBe(false);
  });

  it("makes a provisional line from the grid card", () => {
    expect(provisionalLine(offColor, "side", 3)).toMatchObject({
      oracleId: "Shock",
      board: "side",
      quantity: 3,
      printingId: "printing-Shock",
      owned: 1,
      otherDecks: [],
      priceCents: 25,
    });
  });
});
