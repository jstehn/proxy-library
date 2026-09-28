// An admin resetting a player's library, against real Postgres (design doc 12).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrintingId, SealedProductId } from "@/modules/catalog";
import { makeDecks } from "@/modules/decks";
import { makeInventory } from "@/modules/inventory";
import { makeResetPlayer } from "@/modules/reset";
import { makeStore } from "@/modules/store";
import { makeTrades } from "@/modules/trades";
import { makeWallet } from "@/modules/wallet";
import { Cents, UserId } from "@/shared/kernel";
import { randomSeed } from "@/shared/runtime";
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
const inventory = makeInventory({ unitOfWork, clock, seeds: { newSeed: randomSeed } });
const decks = makeDecks({ unitOfWork, clock });
const trades = makeTrades({ unitOfWork, clock });
const wallet = makeWallet({ unitOfWork, clock });
const resetPlayer = makeResetPlayer({ unitOfWork, clock });

const PLAY_PACK = SealedProductId.of("1370435e-4972-553f-9dac-dc72408625ea");
const jack = actor("jack");
const bob = actor("bob");
const admin = actor("admin", true);

/** A fixture printing with a nonfoil price under $5. */
async function cheapCard(): Promise<PrintingId> {
  const [row] = (
    await db.execute<{ id: string }>(sql`
      select p.id from printings p
        join price_snapshots s on s.printing_id = p.id and s.finish = 'nonfoil'
       where s.usd_cents between 10 and 500 order by p.id limit 1
    `)
  ).rows;
  return PrintingId.of(row.id);
}

beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack", "bob", "admin"]));

describe("resetting a player", () => {
  it("empties the library, closes open trades and restores the starting grant", async () => {
    // Jack: two packs (one opened), a single, a deck, and trades both ways with Bob.
    const card = await cheapCard();
    const bought = await store.buySealed(jack, { productId: PLAY_PACK, quantity: 2 });
    if (!bought.ok) throw new Error(bought.error.kind);
    expect((await inventory.openItem(jack, bought.value.items[0].id)).ok).toBe(true);
    await store.buySingle(jack, { printingId: card, finish: "nonfoil", quantity: 1 });
    await store.buySingle(bob, { printingId: card, finish: "nonfoil", quantity: 1 });
    await decks.createDeck(jack, { name: "Test deck", format: "casual" });
    const fromJack = await trades.proposeTrade(jack, {
      recipientId: bob.userId,
      items: [{ kind: "card", from: "proposer", printingId: card, finish: "nonfoil", quantity: 1 }],
      message: "",
    });
    const fromBob = await trades.proposeTrade(bob, {
      recipientId: jack.userId,
      items: [{ kind: "money", from: "proposer", amount: Cents.of(100) }],
      message: "",
    });
    if (!fromJack.ok || !fromBob.ok) throw new Error("proposals failed");
    const jackCopies = await db.execute<{ total: number }>(
      sql`select sum(quantity)::int as total from collection_cards where user_id = 'jack'`,
    );
    const bobBalance = await balance("bob");

    const result = await resetPlayer(admin, jack.userId);

    expect(result).toEqual({
      ok: true,
      value: {
        tradesClosed: 2,
        balance: Cents.of(5000),
        itemsRemoved: 2,
        copiesRemoved: jackCopies.rows[0].total,
        decksDeleted: 1,
        eventsForgotten: expect.any(Number) as number,
      },
    });
    expect(await count("collection_cards", "user_id = 'jack'")).toBe(0);
    expect(await count("sealed_items", "owner_id = 'jack'")).toBe(0);
    expect(await count("item_openings")).toBe(0);
    expect(await count("decks", "owner_id = 'jack'")).toBe(0);
    expect(await count("activity_events", "actor_id = 'jack'")).toBe(0);
    expect(await count("trades", `id = ${fromJack.value} and status = 'cancelled'`)).toBe(1);
    expect(await count("trades", `id = ${fromBob.value} and status = 'declined'`)).toBe(1);

    // Money: back to $50 with one grant making up what was spent, and nothing deleted.
    expect(await balance("jack")).toBe(5000);
    expect(
      await count(
        "ledger_entries",
        "user_id = 'jack' and kind = 'grant' and note = 'Library reset by admin'",
      ),
    ).toBe(1);
    expect(await count("ledger_entries", "user_id = 'jack' and kind = 'purchase_sealed'")).toBe(1);
    // Cards: the history still adds up to what's owned (nothing).
    const history = await db.execute<{ total: number }>(
      sql`select sum(quantity)::int as total from acquisitions where user_id = 'jack'`,
    );
    expect(history.rows[0].total).toBe(0);
    expect(await count("acquisitions", "user_id = 'jack' and source = 'reset'")).toBeGreaterThan(0);

    // Bob is untouched.
    expect(await count("collection_cards", "user_id = 'bob'")).toBe(1);
    expect(await balance("bob")).toBe(bobBalance);
  });

  it("takes extra money away with a correction", async () => {
    await wallet.grantMoney(admin, { userId: jack.userId, amount: Cents.of(3000), note: "gift" });
    expect(await resetPlayer(admin, jack.userId)).toMatchObject({ ok: true });
    expect(await balance("jack")).toBe(5000);
    expect(
      await count(
        "ledger_entries",
        "user_id = 'jack' and kind = 'correction' and amount_cents = -3000",
      ),
    ).toBe(1);
  });

  it("works on an empty library, and only for admins and real players", async () => {
    expect(await resetPlayer(admin, bob.userId)).toMatchObject({
      ok: true,
      value: { copiesRemoved: 0, itemsRemoved: 0, decksDeleted: 0, tradesClosed: 0 },
    });
    expect(await resetPlayer(jack, bob.userId)).toEqual({
      ok: false,
      error: { kind: "Forbidden" },
    });
    expect(await resetPlayer(admin, UserId.of("nobody"))).toEqual({
      ok: false,
      error: { kind: "PlayerNotFound" },
    });
  });
});
