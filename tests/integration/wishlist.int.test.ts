// The wishlist (design doc 26) against real Postgres and the fixture catalog: the page's
// answers, the unique index, and buying from the list in one transaction with the store.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Cents, err } from "@/shared/kernel";
import {
  makeWishlist,
  wishedPrintings,
  wishesAtTarget,
  wishesForCard,
  wishLines,
  wishlistAnswers,
  type WalletOutlook,
  type WishDetails,
  type WishRequest,
} from "@/modules/wishlist";
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
beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack", "bob"]));

const jack = actor("jack");
const bob = actor("bob");
const wishlist = makeWishlist({ unitOfWork, clock });
const ONE: WishDetails = { quantity: 1, targetPrice: null, note: "" };

/** Dawn's Truce has two nonfoil printings for sale: #9 at $9.82 and #295 at $14.20. */
async function printingOf(name: string, collectorNumber: string): Promise<string> {
  const result = await db.execute<{ id: string }>(
    sql`select id from printings where name = ${name} and collector_number = ${collectorNumber}`,
  );
  return result.rows[0].id;
}

async function add(request: WishRequest, details = ONE, player = jack) {
  const result = await wishlist.addWish(player, { request, details });
  if (!result.ok) throw new Error(result.error.kind);
  return result.value.wish;
}

const outlook = (cents: number): WalletOutlook => ({
  balance: Cents.of(cents),
  allowance: Cents.zero,
  allowancePeriodDays: 7,
  nextPayday: new Date(),
});

describe("the Wishlist page's answers", () => {
  it("offers the cheapest printing of the card, whichever printing it was wished from", async () => {
    const borderless = await printingOf("Dawn's Truce", "295");
    const wish = await add({ kind: "anyPrinting", printingId: borderless, finish: "nonfoil" });
    expect(wish.savedPrice).toBe(982);

    const [line] = wishLines(await wishlistAnswers(db, jack.userId), outlook(500));
    expect(line.offer?.collectorNumber).toBe("9");
    expect(line.options.map((option) => option.collectorNumber)).toEqual(["9", "295"]);
    expect(line.status).toEqual({ kind: "shortBy", shortfall: 482, paydays: null });
  });

  it("finds wishes for a card, the ★ printings, and the wishes at target", async () => {
    const regular = await printingOf("Dawn's Truce", "9");
    const borderless = await printingOf("Dawn's Truce", "295");
    await add(
      { kind: "exactPrinting", printingId: borderless, finish: "nonfoil" },
      {
        ...ONE,
        targetPrice: Cents.of(1500),
      },
    );
    await add(
      { kind: "anyPrinting", printingId: regular, finish: "nonfoil" },
      {
        ...ONE,
        targetPrice: Cents.of(500),
      },
    );

    expect((await wishesForCard(db, jack.userId, regular)).map((wish) => wish.target.kind)).toEqual(
      ["exactPrinting", "anyPrinting"],
    );
    expect(await wishedPrintings(db, jack.userId, [regular, borderless])).toEqual(
      new Set([regular, borderless]),
    );
    expect(await wishedPrintings(db, bob.userId, [regular])).toEqual(new Set());
    expect(await wishesAtTarget(db, jack.userId)).toBe(1); // $14.20 ≤ $15; $9.82 > $5
  });
});

describe("the table", () => {
  it("allows one wish per target (rule 1): a second row for it is refused", async () => {
    const regular = await printingOf("Dawn's Truce", "9");
    const wish = await add({ kind: "anyPrinting", printingId: regular, finish: "nonfoil" });
    await expect(
      db.execute(sql`
        insert into wishes (user_id, oracle_id, finish, quantity, created_at)
        values ('jack', ${wish.target.oracleId}, 'nonfoil', 1, now())`),
    ).rejects.toThrow();
    // A foil wish for the same card is a different target.
    await add({ kind: "anyPrinting", printingId: regular, finish: "foil" });
    expect(await count("wishes", "user_id = 'jack'")).toBe(2);
  });
});

describe("buying from the wishlist", () => {
  it("buys through the store and removes the fulfilled wish, in one transaction", async () => {
    const regular = await printingOf("Dawn's Truce", "9");
    const wish = await add({ kind: "anyPrinting", printingId: regular, finish: "nonfoil" });
    const bought = await wishlist.buyWish(jack, {
      wishId: wish.id,
      printingId: regular,
      finish: "nonfoil",
      quantity: 1,
      expectedUnitPrice: Cents.of(982),
    });
    expect(bought).toMatchObject({ ok: true, value: { isFulfilled: true } });
    expect(await balance("jack")).toBe(5000 - 982);
    expect(await count("wishes")).toBe(0);
    expect(await count("collection_cards", `user_id = 'jack' and printing_id = '${regular}'`)).toBe(
      1,
    );
  });

  it("changes nothing when the wallet can't pay: the money, the store's record and the wish stay", async () => {
    const regular = await printingOf("Dawn's Truce", "9");
    const wish = await add(
      { kind: "anyPrinting", printingId: regular, finish: "nonfoil" },
      {
        ...ONE,
        quantity: 6,
      },
    );
    const result = await wishlist.buyWish(jack, {
      wishId: wish.id,
      printingId: regular,
      finish: "nonfoil",
      quantity: 6,
      expectedUnitPrice: Cents.of(982),
    });
    expect(result).toEqual(
      err({ kind: "InsufficientFunds", balance: Cents.of(5000), required: Cents.of(6 * 982) }),
    );
    expect(await count("store_transactions")).toBe(0);
    expect(await count("wishes")).toBe(1);
    expect(await count("collection_cards", "user_id = 'jack'")).toBe(0);
  });
});
