import { describe, expect, it } from "vitest";
import { fixtureCard } from "../../../../../../tests/fixtures/features/cards";
import { entersTapped } from "./enters-tapped";
import { helpsOpponents } from "./helps-opponents";

describe("enters-tapped reads", () => {
  it.each([
    { card: "Forest", expected: "never" },
    { card: "Command Tower", expected: "never" },
    { card: "Sol Ring", expected: "never" },
    { card: "Azorius Chancery", expected: "always" },
    { card: "Glacial Fortress", expected: "sometimes" },
    { card: "Overgrown Tomb", expected: "sometimes" },
    // Only a back face says it: the faces are read together.
    { card: "Bala Ged Recovery // Bala Ged Sanctuary", expected: "always" },
  ])("$card is $expected", ({ card, expected }) => {
    expect(entersTapped.recognize(fixtureCard(card))).toBe(expected);
  });
});

describe("helps-opponents reads", () => {
  it.each([
    { card: "Forbidden Orchard", expected: true },
    { card: "Command Tower", expected: false },
    { card: "Azorius Chancery", expected: false },
  ])("$card is $expected", ({ card, expected }) => {
    expect(helpsOpponents.recognize(fixtureCard(card))).toBe(expected);
  });
});
