// The candidate pool's SQL pieces (audit S2, P07b) against real Postgres: what counts as owned,
// which copy stands for a card, and which printing the store sells cheapest.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cheapestForSale, cheapestOfCards, notOwned, ownedPerCard } from "@/modules/decks";
import { UserId } from "@/shared/kernel";
import { actor, close, db, loadFixtureCatalog, resetPlayers } from "./harness";

afterAll(close);

const jack = actor("jack").userId;
const amy = UserId.of("amy");
const DAY = "2026-01-01";

/** A copy of printing `from` under a new id (another printing of the same card). */
async function printingLike(from: string, id: string): Promise<void> {
  await db.execute(sql`drop table if exists dup`);
  await db.execute(sql`create temp table dup as select * from printings where id = ${from}`);
  await db.execute(
    sql`update dup set id = ${id}, scryfall_id = ${`scry-${id}`}, collector_number = ${id}`,
  );
  await db.execute(sql`insert into printings select * from dup`);
  await db.execute(sql`drop table dup`);
}

async function price(printing: string, finish: string, cents: number): Promise<void> {
  await db.execute(
    sql`insert into price_snapshots (printing_id, finish, day, usd_cents) values (${printing}, ${finish}, ${DAY}, ${cents})
        on conflict (printing_id, finish, day) do update set usd_cents = ${cents}`,
  );
}

async function own(
  user: string,
  printing: string,
  finish: string,
  quantity: number,
  table = "collection_cards",
): Promise<void> {
  const stamps = table === "real_cards" ? sql`, now(), now()` : sql``;
  const stampColumns = table === "real_cards" ? sql`, added_at, updated_at` : sql``;
  await db.execute(
    sql`insert into ${sql.raw(table)} (user_id, printing_id, finish, quantity${stampColumns}) values (${user}, ${printing}, ${finish}, ${quantity}${stamps})`,
  );
}

let card: string; // the oracle id used throughout
let first: string; // its first printing

beforeAll(async () => {
  await loadFixtureCatalog();
});

beforeEach(async () => {
  await resetPlayers(["jack", "amy"]);
  await db.execute(sql`delete from price_snapshots where printing_id like 'dup-%'`);
  await db.execute(sql`delete from printings where id like 'dup-%'`);
  const [row] = (
    await db.execute<{ id: string; oracle_id: string }>(
      sql`select id, oracle_id from printings order by id limit 1`,
    )
  ).rows;
  first = row.id;
  card = row.oracle_id;
  await printingLike(first, "dup-a");
  await printingLike(first, "dup-b");
});

async function rows(fragment: ReturnType<typeof ownedPerCard>) {
  return (await db.execute<Record<string, unknown>>(sql`select * from ${fragment} o`)).rows;
}

describe("ownedPerCard", () => {
  it("makes one row per card across printings and finishes", async () => {
    await own("jack", "dup-a", "nonfoil", 2);
    await own("jack", "dup-b", "foil", 1);
    const result = await rows(ownedPerCard(jack, false));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ oracle_id: card, owned: 3 });
  });

  it("shows the most special copy, and also names the copy held most", async () => {
    await price("dup-a", "nonfoil", 100);
    await price("dup-b", "foil", 900);
    await own("jack", "dup-a", "nonfoil", 4);
    await own("jack", "dup-b", "foil", 1);
    const [row] = await rows(ownedPerCard(jack, false));
    expect(row).toMatchObject({
      printing_id: "dup-b",
      finish: "foil",
      copies_printing_id: "dup-a",
      copies_finish: "nonfoil",
    });
  });

  it("counts real copies only when asked, and says how many are real", async () => {
    await own("jack", "dup-a", "nonfoil", 1);
    await own("jack", "dup-b", "nonfoil", 2, "real_cards");
    expect((await rows(ownedPerCard(jack, false)))[0]).toMatchObject({ owned: 1, owned_real: 0 });
    expect((await rows(ownedPerCard(jack, true)))[0]).toMatchObject({ owned: 3, owned_real: 2 });
  });

  it("is only the player's own, and can be limited to some cards", async () => {
    await own("amy", "dup-a", "nonfoil", 1);
    expect(await rows(ownedPerCard(jack, false))).toHaveLength(0);
    expect(await rows(ownedPerCard(amy, false, ["nothing"]))).toHaveLength(0);
    expect(await rows(ownedPerCard(amy, false, [card]))).toHaveLength(1);
  });
});

describe("notOwned", () => {
  async function unowned(withReal: boolean) {
    return (
      await db.execute<{ id: string }>(
        sql`select p.id from printings p where p.oracle_id = ${card} and ${notOwned(jack, withReal)}`,
      )
    ).rows.length;
  }

  it("leaves out every printing of a card owned in any printing", async () => {
    expect(await unowned(false)).toBeGreaterThan(0);
    await own("jack", "dup-b", "foil", 1);
    expect(await unowned(false)).toBe(0);
  });

  it("counts a real copy as owned only when real cards count", async () => {
    await own("jack", "dup-a", "nonfoil", 1, "real_cards");
    expect(await unowned(false)).toBeGreaterThan(0);
    expect(await unowned(true)).toBe(0);
  });
});

describe("cheapestForSale", () => {
  async function cheapest(oracleId = card) {
    const result = await db.execute<{ printing_id: string; finish: string; usd_cents: number }>(
      sql`select * from (select ${oracleId}::text as oracle_id) c
            join lateral ${cheapestForSale(sql`c.oracle_id`)} best on true`,
    );
    return result.rows[0];
  }

  it("picks the cheapest finish of any printing and keeps the finish", async () => {
    await db.execute(sql`delete from price_snapshots where printing_id = ${first}`);
    await price("dup-a", "nonfoil", 300);
    await price("dup-b", "nonfoil", 500);
    await price("dup-b", "foil", 150);
    expect(await cheapest()).toMatchObject({
      printing_id: "dup-b",
      finish: "foil",
      usd_cents: "150",
    });
  });

  it("breaks a tie on the lowest printing id", async () => {
    await price("dup-b", "nonfoil", 100);
    await price("dup-a", "nonfoil", 100);
    await db.execute(sql`delete from price_snapshots where printing_id = ${first}`);
    expect((await cheapest())?.printing_id).toBe("dup-a");
  });

  it("ignores printings in a set that isn't for sale", async () => {
    await db.execute(sql`delete from price_snapshots where printing_id = ${first}`);
    await db.execute(sql`update card_sets set is_enabled = false`);
    await price("dup-a", "nonfoil", 100);
    expect(await cheapest()).toBeUndefined();
    await db.execute(sql`update card_sets set is_enabled = true`);
  });

  it("gives nothing for a card with no price", async () => {
    await db.execute(
      sql`delete from price_snapshots where printing_id in (select id from printings where oracle_id = ${card})`,
    );
    expect(await cheapest()).toBeUndefined();
  });
});

describe("cheapestOfCards", () => {
  async function priced(maxPriceCents?: number, ids: string[] | null = [card]) {
    return (
      await db.execute<{ oracle_id: string; usd_cents: number }>(
        sql`select * from ${cheapestOfCards(jack, false, ids, sql`true`, maxPriceCents)} c`,
      )
    ).rows;
  }

  it("leaves out a card the player owns", async () => {
    await price("dup-a", "nonfoil", 100);
    expect(await priced()).toHaveLength(1);
    await own("jack", "dup-b", "nonfoil", 1);
    expect(await priced()).toHaveLength(0);
  });

  it("drops a card whose cheapest printing is dearer than the cap", async () => {
    await db.execute(sql`delete from price_snapshots where printing_id = ${first}`);
    await price("dup-a", "nonfoil", 400);
    expect(await priced(300)).toHaveLength(0);
    expect(await priced(400)).toHaveLength(1);
  });

  it("can look at every card, not a list", async () => {
    expect((await priced(undefined, null)).length).toBeGreaterThan(0);
  });
});
