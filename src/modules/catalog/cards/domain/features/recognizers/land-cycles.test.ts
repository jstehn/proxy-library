import { describe, expect, it } from "vitest";
import { fixtureCard } from "../../../../../../../tests/fixtures/features/cards";
import { landCycles } from "./land-cycles";

describe("land-cycles reads", () => {
  it.each([
    { card: "Forest", expected: ["fetchable"] },
    { card: "Command Tower", expected: [] },
    { card: "Wastes", expected: [] },
    { card: "Sol Ring", expected: [] },
    { card: "Volcanic Island", expected: ["fetchable", "dual"] },
    { card: "Steam Vents", expected: ["fetchable", "shockland"] },
    { card: "Scalding Tarn", expected: ["fetchland"] },
    { card: "Sulfur Falls", expected: ["checkland"] },
    { card: "Spirebluff Canal", expected: ["fastland"] },
    { card: "Stormcarved Coast", expected: ["slowland"] },
    { card: "Shivan Reef", expected: ["painland"] },
    { card: "Izzet Boilerworks", expected: ["bounceland"] },
    { card: "Temple of Epiphany", expected: ["scryland"] },
    { card: "Swiftwater Cliffs", expected: ["gainland"] },
    { card: "Ketria Triome", expected: ["fetchable", "triome"] },
    { card: "Canyon Slough", expected: ["fetchable", "cycleland"] },
    { card: "Raging Ravine", expected: ["manland"] },
    { card: "Riverglide Pathway // Lavaglide Pathway", expected: ["pathway"] },
    // A land face makes it a land (decision 1), but it is in no cycle.
    { card: "Valakut Awakening // Valakut Stoneforge", expected: [] },
  ])("$card is $expected", ({ card, expected }) => {
    expect(landCycles.recognize(fixtureCard(card))).toEqual(expected);
  });
});
