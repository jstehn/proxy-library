// The shared price fragments (refactor P03) against real Postgres: one printing with a known
// history of snapshots, read every way the app reads a "current price".
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cheapestPrice,
  latestPrice,
  latestPriceRows,
  latestPricesByFinish,
  latestSnapshot,
  newestDayPrice,
  newestDayPrices,
  newestPriceDay,
  nonfoilFirstPrice,
} from "@/shared/db";
import { close, db, loadFixtureCatalog } from "../../../tests/integration/harness";

afterAll(close);

let printingId = "";

beforeAll(async () => {
  await loadFixtureCatalog();
  const found = await db.execute<{ id: string }>(sql`select id from printings limit 1`);
  printingId = found.rows[0].id;
  await db.execute(sql`delete from price_snapshots where printing_id = ${printingId}`);
  // Nonfoil: 500 on 2026-01-01, 300 on 2026-01-02. Foil: 900 on 2026-01-02. Etched: 250 on
  // 2026-01-01 only (an older price than the rest, still its finish's newest).
  await db.execute(sql`
    insert into price_snapshots (printing_id, finish, day, usd_cents) values
      (${printingId}, 'nonfoil', '2026-01-01', 500),
      (${printingId}, 'nonfoil', '2026-01-02', 300),
      (${printingId}, 'foil', '2026-01-02', 900),
      (${printingId}, 'etched', '2026-01-01', 250)
  `);
});

async function scalar(fragment: SQL) {
  const result = await db.execute<{ value: unknown }>(sql`select ${fragment}::text as value`);
  return result.rows[0].value;
}

// Postgres hands bigint back as text; a price is a number.
const asCents = async (fragment: SQL) => {
  const value = await scalar(fragment);
  return value === null ? null : Number(value);
};

describe("price fragments", () => {
  it("latestPrice: the newest price in one finish", async () => {
    expect(await asCents(latestPrice(sql`${printingId}`, "'nonfoil'"))).toBe(300);
    expect(await asCents(latestPrice(sql`${printingId}`, "'foil'"))).toBe(900);
    expect(await asCents(latestPrice(sql`${printingId}`, "'etched'"))).toBe(250);
  });

  it("cheapestPrice: the lowest of each finish's newest price", async () => {
    expect(await asCents(cheapestPrice(sql`${printingId}`))).toBe(250);
  });

  it("latestPricesByFinish: one number per finish", async () => {
    expect(JSON.parse(String(await scalar(latestPricesByFinish(sql`${printingId}`))))).toEqual({
      nonfoil: 300,
      foil: 900,
      etched: 250,
    });
  });

  it("latestPriceRows: one row per finish", async () => {
    const rows = await db.execute<{ finish: string; usd_cents: number }>(
      sql`select finish, usd_cents::int as usd_cents from ${latestPriceRows(sql`${printingId}`)} latest order by finish`,
    );
    expect(rows.rows.map((row) => [row.finish, row.usd_cents])).toEqual([
      ["etched", 250],
      ["foil", 900],
      ["nonfoil", 300],
    ]);
  });

  it("newestDayPrice: the cheapest price on the newest day", async () => {
    expect(await asCents(newestDayPrice(sql`${printingId}`))).toBe(300);
  });

  it("nonfoilFirstPrice: the nonfoil price when there is one", async () => {
    expect(await asCents(nonfoilFirstPrice(sql`${printingId}`))).toBe(300);
  });

  it("latestSnapshot: the newest price and its day", async () => {
    const rows = await db.execute<{ usd_cents: number; day: string }>(
      sql`select usd_cents::int as usd_cents, day::text as day from ${latestSnapshot(sql`${printingId}`, "'nonfoil'")} s`,
    );
    expect(rows.rows).toEqual([{ usd_cents: 300, day: "2026-01-02" }]);
  });

  it("an unpriced printing has no price", async () => {
    expect(await asCents(latestPrice("'no-such-printing'", "'nonfoil'"))).toBeNull();
    expect(await asCents(cheapestPrice("'no-such-printing'"))).toBeNull();
  });

  it("newestPriceDay and newestDayPrices cover the whole table's newest day", async () => {
    const newest = await db.execute<{ day: string }>(sql`select ${newestPriceDay()}::text as day`);
    const rows = await db.execute<{ day: string }>(
      sql`select distinct (select ${newestPriceDay()}::text) as day from ${newestDayPrices()} s`,
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows[0].day).toBe(newest.rows[0].day);
  });
});
