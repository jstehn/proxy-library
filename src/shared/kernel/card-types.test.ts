import { describe, expect, it } from "vitest";
import { cardTypes } from "./card-types";

describe("cardTypes", () => {
  const cases: ReadonlyArray<
    [
      name: string,
      typeLine: string,
      land: boolean,
      onFront: boolean,
      basic: boolean,
      creature: boolean,
    ]
  > = [
    ["a basic", "Basic Land — Forest", true, true, true, false],
    ["a snow basic", "Basic Snow Land — Island", true, true, true, false],
    ["a dual", "Land — Plains Island", true, true, false, false],
    ["an artifact land", "Artifact Land", true, true, false, false],
    ["a creature land", "Land Creature — Forest Dryad", true, true, false, true],
    ["a spell with a land back face", "Instant // Land", true, false, false, false],
    ["a land with a spell back face", "Land // Instant", true, true, false, false],
    ["a land on both faces", "Land // Land", true, true, false, false],
    ["a split card", "Instant // Instant", false, false, false, false],
    ["a creature", "Legendary Creature — Elf Druid", false, false, false, true],
    [
      "a transforming creature",
      "Creature — Human // Creature — Werewolf",
      false,
      false,
      false,
      true,
    ],
    ["a token", "Token Creature — Soldier", false, false, false, true],
    [
      "a word that only contains Land",
      "Legendary Planeswalker — Landon",
      false,
      false,
      false,
      false,
    ],
  ];

  it.each(cases)("%s", (_name, typeLine, land, onFront, basic, creature) => {
    const types = cardTypes(typeLine);
    expect([types.isLand, types.isLandOnFront, types.isBasic, types.isCreature]).toEqual([
      land,
      onFront,
      basic,
      creature,
    ]);
  });

  it("lists the words of each face", () => {
    expect(cardTypes("Instant // Land — Forest").faces).toEqual([
      ["Instant"],
      ["Land", "—", "Forest"],
    ]);
  });
});
