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

  it.each([
    {
      name: "Training Center",
      typeLine: "Land",
      text: "This land enters tapped unless you have two or more opponents.\n{T}: Add {U} or {R}.",
      expected: ["bondland"],
    },
    {
      name: "Cascade Bluffs",
      typeLine: "Land",
      text: "{T}: Add {C}.\n{U/R}, {T}: Add {U}{U}, {U}{R}, or {R}{R}.",
      expected: ["filterland"],
    },
    {
      name: "Fiery Islet",
      typeLine: "Land",
      text: "{T}, Pay 1 life: Add {U} or {R}.\n{1}, {T}, Sacrifice this land: Draw a card.",
      expected: ["horizonland"],
    },
    {
      name: "Prairie Stream",
      typeLine: "Land — Plains Island",
      text: "This land enters tapped unless you control two or more basic lands.",
      expected: ["fetchable", "tangoland"],
    },
    {
      name: "Frostboil Snarl",
      typeLine: "Land",
      text: "As this land enters, you may reveal an Island or Mountain card from your hand. If you don't, this land enters tapped.\n{T}: Add {U} or {R}.",
      expected: ["shadowland"],
    },
    {
      name: "Thundering Falls",
      typeLine: "Land — Island Mountain",
      text: "This land enters tapped.\nWhen this land enters, surveil 1.",
      expected: ["fetchable", "surveilland"],
    },
    {
      name: "Floodfarm Verge",
      typeLine: "Land",
      text: "{T}: Add {W}.\n{T}: Add {U}. Activate only if you control a Plains or an Island.",
      expected: ["verge"],
    },
    {
      name: "Arcane Sanctum",
      typeLine: "Land",
      text: "This land enters tapped.\n{T}: Add {W}, {U}, or {B}.",
      expected: ["triland"],
    },
    {
      name: "Calciform Pools",
      typeLine: "Land",
      text: "{T}: Add {C}.\n{1}, {T}: Put a storage counter on this land.",
      expected: ["storageland"],
    },
  ])("recognizes $name as $expected", ({ name, typeLine, text, expected }) => {
    expect(
      landCycles.recognize({
        oracleId: `test-${name}`,
        manaValue: 0,
        keywords: [],
        producedMana: [],
        faces: [{ name, typeLine, text }],
      }),
    ).toEqual(expected);
  });
});
