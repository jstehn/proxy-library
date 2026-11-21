import { describe, expect, it } from "vitest";
import { fixtureCard } from "../../../../../../../tests/fixtures/features/cards";
import { tapMana } from "./tap-mana";

// The pattern for every recognizer: a table over real card text, plus near misses.

describe("tap-mana reads", () => {
  it.each([
    { card: "Sol Ring", expected: { isSource: true, amount: 2, requiresFiveLands: false } },
    { card: "Llanowar Elves", expected: { isSource: true, amount: 1, requiresFiveLands: false } },
    { card: "Mana Vault", expected: { isSource: true, amount: 3, requiresFiveLands: false } },
    { card: "Azorius Chancery", expected: { isSource: true, amount: 2, requiresFiveLands: false } },
    { card: "Forest", expected: { isSource: true, amount: 1, requiresFiveLands: false } },
    { card: "Wastes", expected: { isSource: true, amount: 1, requiresFiveLands: false } },
    // "Add one mana of any color": no symbols to count, so Scryfall's produced mana decides.
    {
      card: "Birds of Paradise",
      expected: { isSource: true, amount: 1, requiresFiveLands: false },
    },
    // Depends on the board, so no amount without one.
    {
      card: "Temple of the False God",
      expected: { isSource: true, amount: 0, requiresFiveLands: true },
    },
    {
      card: "Shrine of the Forsaken Gods",
      expected: { isSource: true, amount: 1, requiresFiveLands: false },
    },
    // A land on the back face still makes mana.
    {
      card: "Bala Ged Recovery // Bala Ged Sanctuary",
      expected: { isSource: true, amount: 1, requiresFiveLands: false },
    },
  ])("$card", ({ card, expected }) => {
    expect(tapMana.recognize(fixtureCard(card))).toEqual(expected);
  });

  // Moved unchanged: the reminder text of a Powerstone maker counts as a tap ability.
  it("counts reminder text, as the old code did", () => {
    expect(tapMana.recognize(fixtureCard("Cityscape Leveler")).isSource).toBe(true);
  });
});

describe("tap-mana ignores", () => {
  it.each(["Wrath of God", "Cultivate", "Delver of Secrets // Insectile Aberration"])(
    "%s",
    (card) => {
      expect(tapMana.recognize(fixtureCard(card))).toEqual({
        isSource: false,
        amount: 0,
        requiresFiveLands: false,
      });
    },
  );

  it("counts a ritual as a source, as the old function did", () => {
    // Dark Ritual is in Scryfall's produced mana, like the old function said.
    expect(tapMana.recognize(fixtureCard("Dark Ritual"))).toEqual({
      isSource: true,
      amount: 1,
      requiresFiveLands: false,
    });
  });
});
