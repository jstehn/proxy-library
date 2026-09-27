// The BoosterSource adapter against real Postgres: recipes and facts read back from the
// catalog's tables, including the newest price per finish.
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  boosterConfigs,
  cardSets,
  priceSnapshots,
  printings,
} from "@/modules/catalog/infrastructure/schema";
import { SetCode } from "@/modules/catalog";
import { loadConfig } from "@/shared/config";
import { createDatabase } from "@/shared/db";
import { samplePrintingId } from "../testing/recipes";
import { drizzleBoosterSource } from "./drizzle-booster-source";

const { db, close } = createDatabase(loadConfig().databaseUrl);
afterAll(close);

const source = drizzleBoosterSource(db);
const key = { setCode: SetCode.of("TST"), boosterType: "play" };

function printingRow(id: string, overrides: Partial<typeof printings.$inferInsert> = {}) {
  return {
    id,
    setCode: "TST",
    collectorNumber: id,
    name: `Card ${id}`,
    oracleId: `oracle-${id}`,
    scryfallId: `scryfall-${id}`,
    rarity: "common",
    colors: ["G"],
    colorIdentity: ["G"],
    manaCost: "{G}",
    manaValue: 1,
    typeLine: "Creature — Squirrel",
    layout: "normal",
    finishes: ["nonfoil", "foil"],
    borderColor: "black",
    frameVersion: "2015",
    frameEffects: [],
    promoTypes: [],
    isFullArt: false,
    variantLabel: "",
    ...overrides,
  };
}

async function enableSet(isEnabled: boolean) {
  await db
    .update(cardSets)
    .set({ isEnabled })
    .where(sql`${cardSets.code} = 'TST'`);
}

beforeEach(async () => {
  await db.execute(
    sql`truncate sync_runs, price_snapshots, deck_lists, sealed_products, booster_configs, printings, card_sets cascade`,
  );
  await db.insert(cardSets).values({
    code: "TST",
    name: "Test Set",
    releaseDate: "2026-01-01",
    type: "expansion",
    keyruneCode: "tst",
    isEnabled: true,
  });
  await db.insert(printings).values([
    printingRow("1"),
    printingRow("2", { rarity: "mythic", colors: [], finishes: ["etched"] }),
    printingRow("3", { typeLine: "Basic Land — Forest", colors: [] }),
    printingRow("4", { typeLine: "Basic Snow Land — Forest", colors: [] }),
    printingRow("5", { typeLine: "Land — Forest Plains" }), // a nonbasic with land types
  ]);
  await db.insert(boosterConfigs).values({
    setCode: "TST",
    boosterType: "play",
    variants: [{ weight: 1, slots: { common: 1 } }],
    sheets: {
      common: {
        cards: [{ printingId: "1", weight: 2 }],
        isFoil: false,
        allowDuplicates: false,
        balanceColors: true,
        isFixed: false,
      },
    },
    sourceSetCodes: ["TST"],
  });
});

describe("drizzleBoosterSource", () => {
  it("reads a recipe back, checked and typed", async () => {
    const config = await source.boosterConfig(key);
    expect(config).toEqual({
      setCode: "TST",
      boosterType: "play",
      variants: [{ weight: 1, slots: { common: 1 } }],
      sheets: {
        common: {
          cards: [{ printingId: "1", weight: 2 }],
          isFoil: false,
          allowDuplicates: false,
          balanceColors: true,
          isFixed: false,
        },
      },
      sourceSetCodes: ["TST"],
    });
  });

  it("has no recipe for a missing booster type", async () => {
    expect(await source.boosterConfig({ ...key, boosterType: "collector" })).toBeNull();
  });

  it("still opens a disabled set's packs, but doesn't list its recipes", async () => {
    await enableSet(false);
    expect(await source.boosterConfig(key)).not.toBeNull();
    expect(await source.boosterKeys()).toEqual([]);
  });

  it("refuses a stored recipe that isn't the right shape", async () => {
    await db.update(boosterConfigs).set({ variants: [{ weight: "lots" }] });
    await expect(source.boosterConfig(key)).rejects.toThrow();
  });

  it("reads facts with the newest price per finish", async () => {
    await db.insert(priceSnapshots).values([
      { printingId: "1", finish: "nonfoil", day: "2026-09-25", usdCents: 10 },
      { printingId: "1", finish: "nonfoil", day: "2026-09-26", usdCents: 12 },
      { printingId: "1", finish: "foil", day: "2026-09-24", usdCents: 55 },
    ]);
    const facts = await source.printingFacts(["1", "2", "missing"].map(samplePrintingId));
    expect(facts.get(samplePrintingId("1"))).toEqual({
      name: "Card 1",
      collectorNumber: "1",
      rarity: "common",
      colors: ["G"],
      finishes: ["nonfoil", "foil"],
      isBasicLand: false,
      marketPrice: { nonfoil: 12, foil: 55 },
    });
    expect(facts.get(samplePrintingId("2"))).toMatchObject({
      rarity: "mythic",
      finishes: ["etched"],
      marketPrice: {},
    });
    expect(facts.has(samplePrintingId("missing"))).toBe(false);
  });

  it("recognizes basic lands, snow ones included, but not nonbasics with land types", async () => {
    const facts = await source.printingFacts(["3", "4", "5"].map(samplePrintingId));
    expect(["3", "4", "5"].map((id) => facts.get(samplePrintingId(id))?.isBasicLand)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("lists the recipes of enabled sets", async () => {
    expect(await source.boosterKeys()).toEqual([{ setCode: "TST", boosterType: "play" }]);
  });
});
