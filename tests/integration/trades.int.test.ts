// Trades against real Postgres (design doc 10, section 11).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrintingId } from "@/modules/catalog";
import { makeStore } from "@/modules/store";
import { makeTrades, type TradeItem } from "@/modules/trades";
import { Cents } from "@/shared/kernel";
import {
  actor,
  balance,
  clock,
  close,
  count,
  db,
  loadFixtureCatalog,
  resetPlayers,
  unitOfWork,
} from "./harness";

afterAll(close);

const store = makeStore({ unitOfWork, clock });
const trades = makeTrades({ unitOfWork, clock });
const alice = actor("alice");
const bob = actor("bob");

/** Two cheap fixture printings, one for each player to own. */
async function twoCards(): Promise<[PrintingId, PrintingId]> {
  const rows = (
    await db.execute<{ id: string }>(sql`
      select p.id from printings p join price_snapshots s on s.printing_id = p.id and s.finish = 'nonfoil'
       where p.set_code = 'BLB' and s.usd_cents between 5 and 300 order by p.id limit 2
    `)
  ).rows;
  return [PrintingId.of(rows[0].id), PrintingId.of(rows[1].id)];
}

const card = (from: "proposer" | "recipient", printingId: PrintingId, quantity = 1): TradeItem => ({
  kind: "card",
  from,
  printingId,
  finish: "nonfoil",
  quantity,
});

async function owned(userId: string, printingId: string): Promise<number> {
  const result = await db.execute<{ quantity: number }>(
    sql`select quantity from collection_cards where user_id = ${userId} and printing_id = ${printingId} and finish = 'nonfoil'`,
  );
  return result.rows[0]?.quantity ?? 0;
}

let aliceCard: PrintingId;
let bobCard: PrintingId;

beforeAll(async () => {
  await loadFixtureCatalog();
  [aliceCard, bobCard] = await twoCards();
});

beforeEach(async () => {
  await db.execute(sql`truncate trades, trade_items cascade`);
  await resetPlayers(["alice", "bob"]);
  await store.buySingle(alice, { printingId: aliceCard, finish: "nonfoil", quantity: 2 });
  await store.buySingle(bob, { printingId: bobCard, finish: "nonfoil", quantity: 2 });
});

describe("trades", () => {
  it("moves cards and money both ways, with every ledger in step", async () => {
    const proposed = await trades.proposeTrade(alice, {
      recipientId: bob.userId,
      items: [
        card("proposer", aliceCard, 2),
        { kind: "money", from: "proposer", amount: Cents.of(250) },
        card("recipient", bobCard),
      ],
      message: "",
    });
    if (!proposed.ok) throw new Error(proposed.error.kind);
    const aliceBefore = await balance("alice");
    const bobBefore = await balance("bob");

    expect((await trades.acceptTrade(bob, proposed.value)).ok).toBe(true);
    expect([await owned("alice", aliceCard), await owned("bob", aliceCard)]).toEqual([0, 2]);
    expect([await owned("alice", bobCard), await owned("bob", bobCard)]).toEqual([1, 1]);
    expect(await balance("alice")).toBe(aliceBefore - 250);
    expect(await balance("bob")).toBe(bobBefore + 250);
    expect(await count("ledger_entries", `ref = 'trade:${proposed.value}'`)).toBe(2);
    expect(await count("acquisitions", `ref = 'trade:${proposed.value}'`)).toBe(4); // 2 given, 2 received
  });

  it("refuses acceptance after the proposer sold the card, and rolls everything back", async () => {
    const proposed = await trades.proposeTrade(alice, {
      recipientId: bob.userId,
      items: [
        { kind: "money", from: "recipient", amount: Cents.of(100) },
        card("proposer", aliceCard, 2),
      ],
      message: "",
    });
    if (!proposed.ok) throw new Error(proposed.error.kind);
    await store.sellSingle(alice, { printingId: aliceCard, finish: "nonfoil", quantity: 1 });
    const bobBefore = await balance("bob");

    const accepted = await trades.acceptTrade(bob, proposed.value);
    expect(accepted).toMatchObject({
      ok: false,
      error: { kind: "NoLongerPossible", shortfall: { what: "cards", side: "proposer" } },
    });
    // Bob's money moved first inside the transaction; the rollback undid it.
    expect(await balance("bob")).toBe(bobBefore);
    expect(await count("ledger_entries", "kind in ('trade_in', 'trade_out')")).toBe(0);
    expect(await count("trades", "status = 'proposed'")).toBe(1);
  });

  it("accepts two opposite trades at the same moment without a deadlock", async () => {
    // Alice → Bob and Bob → Alice, each accepted by the other at once: both need both wallets.
    const first = await trades.proposeTrade(alice, {
      recipientId: bob.userId,
      items: [card("proposer", aliceCard)],
      message: "",
    });
    const second = await trades.proposeTrade(bob, {
      recipientId: alice.userId,
      items: [card("proposer", bobCard)],
      message: "",
    });
    if (!first.ok || !second.ok) throw new Error("proposals failed");
    const results = await Promise.all([
      trades.acceptTrade(bob, first.value),
      trades.acceptTrade(alice, second.value),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(await count("trades", "status = 'accepted'")).toBe(2);
  });
});
