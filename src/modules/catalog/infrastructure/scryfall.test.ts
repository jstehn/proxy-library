import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  priceSnapshots,
  standardSetsFromTally,
  tallyStandard,
  type StandardTally,
} from "../domain/rules";
import { PrintingId } from "../domain/types";
import { mapScryfallCard, ScryfallCardSchema } from "./scryfall";

// Real Scryfall lines for the fixture printings, plus 2 synthetic ones (tests/fixtures/README.md).
const lines = readFileSync("tests/fixtures/scryfall/default-cards.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((line) => mapScryfallCard(ScryfallCardSchema.parse(JSON.parse(line))));

describe("mapScryfallCard", () => {
  it("parses prices per finish into cents, with null for a missing price", () => {
    const banishingLight = lines[0];
    expect(banishingLight.prices.nonfoil).toBeTypeOf("number");
    expect(banishingLight.prices.etched).toBeNull();
  });

  it("reads image addresses for the front face", () => {
    expect(lines[0].images?.front.normal).toMatch(/^https:\/\/cards\.scryfall\.io\/normal\//);
    expect(lines[0].images?.back).toBeNull();
  });

  it("flags the synthetic digital card, and reads the Spanish and Japanese-only printings' language", () => {
    expect(lines.filter((card) => card.isDigital)).toHaveLength(1);
    expect(lines.filter((card) => card.language !== "en").map((card) => card.language)).toEqual([
      "es",
      "ja",
    ]);
  });
});

describe("Standard detection", () => {
  it("counts sets where most non-basic English paper cards are Standard-legal", () => {
    const tally: StandardTally = new Map();
    for (const card of lines) tallyStandard(tally, card);
    expect(standardSetsFromTally(tally)).toEqual(["BLB"]); // SPG is a "masterpiece" set
  });

  it("ignores basic lands, which are legal in every set", () => {
    const tally: StandardTally = new Map();
    const oldBasic = {
      ...lines[0],
      setCode: "LEA" as never,
      isStandardLegal: true,
      isBasicLand: true,
    };
    const oldCard = {
      ...lines[0],
      setCode: "LEA" as never,
      isStandardLegal: false,
      isBasicLand: false,
    };
    tallyStandard(tally, oldBasic);
    tallyStandard(tally, oldCard);
    expect(standardSetsFromTally(tally)).toEqual([]);
  });

  it("ignores an old set with a few Standard-legal reprints", () => {
    const tally: StandardTally = new Map();
    const card = (legal: boolean) => ({
      ...lines[0],
      setCode: "M19" as never,
      isStandardLegal: legal,
    });
    for (let i = 0; i < 15; i++) tallyStandard(tally, card(true));
    for (let i = 0; i < 85; i++) tallyStandard(tally, card(false));
    expect(standardSetsFromTally(tally)).toEqual([]);
  });
});

describe("priceSnapshots", () => {
  it("makes one snapshot per finish that has a price", () => {
    const card = {
      prices: { nonfoil: 12 as never, foil: 34 as never, etched: null },
    };
    const printing = { id: PrintingId.of("p1"), finishes: ["nonfoil", "foil", "etched"] as const };
    expect(priceSnapshots(printing, card, "2026-09-27")).toEqual([
      { printingId: "p1", finish: "nonfoil", day: "2026-09-27", price: 12 },
      { printingId: "p1", finish: "foil", day: "2026-09-27", price: 34 },
    ]);
  });

  it("ignores prices for finishes the printing doesn't have", () => {
    const card = { prices: { nonfoil: 12 as never, foil: 34 as never, etched: null } };
    const foilOnly = { id: PrintingId.of("p2"), finishes: ["foil"] as const };
    expect(priceSnapshots(foilOnly, card, "2026-09-27")).toHaveLength(1);
  });
});

describe("tokens (design doc 25)", () => {
  const byName = (name: string) => lines.filter((card) => card.token?.name === name);

  it("keeps paper English tokens, emblems and double-faced tokens, and nothing else", () => {
    const tokens = lines.flatMap((card) => (card.token === null ? [] : [card.token]));
    expect(tokens.map((token) => token.name).sort()).toEqual([
      "Elspeth, Knight-Errant Emblem",
      "Fish",
      "Food",
      "Incubator // Phyrexian",
      "Intrepid Rabbit",
      "Rabbit",
      "Rabbit",
      "Rabbit",
      "Thundertrap Trainer",
      "Treasure",
      "Wall",
    ]);
  });

  it("reads a token's printed text, colours and art, with no cost", () => {
    const [rabbit] = byName("Rabbit").filter((card) => card.setCode === "TBLB");
    expect(rabbit.token).toMatchObject({
      setCode: "tblb",
      layout: "token",
      colors: ["W"],
      faces: [{ name: "Rabbit", manaCost: null, typeLine: "Token Creature — Rabbit", power: "1" }],
    });
    expect(rabbit.token?.images?.front.artCrop).toMatch(/art_crop/);
  });

  it("gives every art of one token the same oracle id", () => {
    const rabbits = byName("Rabbit");
    expect(new Set(rabbits.map((card) => card.token?.oracleId)).size).toBe(1);
  });

  it("reads both faces of a double-faced token, and its back image", () => {
    const [incubator] = byName("Incubator // Phyrexian");
    expect(incubator.token?.faces.map((face) => face.name)).toEqual(["Incubator", "Phyrexian"]);
    expect(incubator.token?.images?.back).not.toBeNull();
  });

  it("lists the tokens a card makes, and not the card itself", () => {
    const beza = lines.find((card) => card.scryfallId.startsWith("fc310a26"));
    const tokenIds = new Set(lines.flatMap((card) => (card.token === null ? [] : [card.token.id])));
    expect(beza?.tokenIds.filter((id) => tokenIds.has(id))).toHaveLength(2);
    expect(beza?.tokenIds).not.toContain(beza?.scryfallId);
  });

  it("reads emblems and helper cards, which Scryfall lists as combo pieces", () => {
    const jailer = mapScryfallCard(
      ScryfallCardSchema.parse({
        id: "jailer",
        set: "ltc",
        set_type: "commander",
        lang: "en",
        prices: {},
        all_parts: [
          { id: "jailer", component: "combo_piece" },
          { id: "monarch", component: "combo_piece" },
          { id: "meld", component: "meld_part" },
        ],
      }),
    );
    expect(jailer.tokenIds).toEqual(["monarch"]);
  });

  it("skips digital and non-English tokens", () => {
    const [rabbit] = byName("Rabbit");
    const raw = (changes: object) =>
      mapScryfallCard(
        ScryfallCardSchema.parse({
          id: "t",
          oracle_id: "o",
          name: "Rabbit",
          set: "tblb",
          set_type: "token",
          layout: "token",
          lang: "en",
          prices: {},
          ...changes,
        }),
      ).token;
    expect(rabbit.token).not.toBeNull();
    expect(raw({})).not.toBeNull();
    expect(raw({ digital: true })).toBeNull();
    expect(raw({ lang: "ja" })).toBeNull();
    expect(raw({ set_type: "expansion", layout: "normal" })).toBeNull();
  });
});
