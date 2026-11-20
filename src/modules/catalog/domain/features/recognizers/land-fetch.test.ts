import { describe, expect, it } from "vitest";
import { fixtureCard } from "../../../../../../tests/fixtures/features/cards";
import { landFetch } from "./land-fetch";

const ANY_BASIC = ["W", "U", "B", "R", "G"];

describe("land-fetch reads", () => {
  it.each([
    { card: "Rampant Growth", expected: { entersTapped: true, colors: ANY_BASIC } },
    { card: "Cultivate", expected: { entersTapped: true, colors: ANY_BASIC } },
    { card: "Kodama's Reach", expected: { entersTapped: true, colors: ANY_BASIC } },
    { card: "Three Visits", expected: { entersTapped: false, colors: ["G"] } },
    { card: "Nature's Lore", expected: { entersTapped: false, colors: ["G"] } },
    { card: "Farseek", expected: { entersTapped: true, colors: ["W", "U", "B", "R"] } },
    // Not spells that fetch: an activated ability, a mana creature, a plain land.
    { card: "Sakura-Tribe Elder", expected: null },
    { card: "Evolving Wilds", expected: null },
    { card: "Llanowar Elves", expected: null },
    { card: "Forest", expected: null },
  ])("$card", ({ card, expected }) => {
    expect(landFetch.recognize(fixtureCard(card))).toEqual(expected);
  });
});
