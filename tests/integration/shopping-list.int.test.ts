// Buying a list of singles (design doc 15, section 3) against real Postgres and the fixture
// catalog: the quote, and a purchase that is all or nothing.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrintingId } from "@/modules/catalog";
import { makeStore, quoteShoppingList, type QuoteOptions } from "@/modules/store";
import { Cents, err } from "@/shared/kernel";
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
beforeEach(() => resetPlayers(["jack"]));

const jack = actor("jack");
const store = makeStore({ unitOfWork, clock });
const DEFAULTS: QuoteOptions = { preference: "cheapest", onlyMissing: true, chosen: {} };
const quote = (text: string, options: Partial<QuoteOptions> = {}) =>
  quoteShoppingList(db, jack.userId, text, { ...DEFAULTS, ...options });

describe("quoting a list", () => {
  it("picks the cheapest printing for sale, or a named one, with the menu of others", async () => {
    const result = await quote("2 Dawn's Truce\n1 Dawn's Truce (BLB) 295\n4 banishing light");
    expect(
      result.lines.map((line) => [line.choice?.collectorNumber, line.toBuy, line.totalCents]),
    ).toEqual([
      ["9", 2, 2 * 982],
      ["295", 1, 1420],
      ["1", 4, 4 * 12],
    ]);
    expect(result.lines[0].options.map((option) => option.collectorNumber)).toEqual(["9", "295"]);
    expect(result.totalCents).toBe(2 * 982 + 1420 + 4 * 12);
  });

  it("explains lines it can't buy: unknown, foil-only, and a finish marker", async () => {
    const result = await quote(
      "1 Not A Real Card\n1 Lumra, Bellow of the Woods\n1 Lumra, Bellow of the Woods *F*",
    );
    expect(result.lines.map((line) => line.problem)).toEqual([
      "no card by that name",
      "no nonfoil printing for sale (sold as foil: mark it *F*)",
      null,
    ]);
    expect(result.lines[2].totalCents).toBe(82_356);
  });

  it("buys only the copies you don't own yet (any printing counts)", async () => {
    await db.execute(sql`
      insert into collection_cards (user_id, printing_id, finish, quantity)
      select ${jack.userId}, id, 'nonfoil', 3 from printings
       where set_code = 'BLB' and collector_number = '1'`);
    const result = await quote("4 Banishing Light");
    expect(result.lines[0]).toMatchObject({ owned: 3, toBuy: 1, totalCents: 12 });
    expect((await quote("4 Banishing Light", { onlyMissing: false })).lines[0].toBuy).toBe(4);
  });
});

describe("buying a list", () => {
  /** Turns a quote into what the buy button sends. */
  const linesOf = (result: Awaited<ReturnType<typeof quote>>) =>
    result.lines.flatMap((line) =>
      line.choice === null || line.toBuy === 0
        ? []
        : [
            {
              printingId: PrintingId.of(line.choice.printingId),
              finish: line.finish,
              quantity: line.toBuy,
            },
          ],
    );

  it("buys what the quote showed, at that price", async () => {
    const result = await quote("2 Dawn's Truce\n4 Banishing Light");
    const bought = await store.buyList(jack, {
      lines: linesOf(result),
      expectedTotal: Cents.of(result.totalCents),
    });
    expect(bought).toMatchObject({ ok: true, value: { cards: 6, total: 2 * 982 + 4 * 12 } });
    expect(await balance("jack")).toBe(5000 - (2 * 982 + 4 * 12));
    expect(await count("collection_cards", `user_id = '${jack.userId}'`)).toBe(2);
    expect(await count("store_transactions", `user_id = '${jack.userId}'`)).toBe(2);
  });

  it("buys nothing at all when the money runs out partway (rules 1 and 3)", async () => {
    // $50.00 to spend: the first two lines fit ($39.40), the third ($14.20 more) doesn't.
    const result = await quote("4 Dawn's Truce\n1 Banishing Light\n1 Dawn's Truce (BLB) 295");
    expect(result.totalCents).toBe(4 * 982 + 12 + 1420);
    const bought = await store.buyList(jack, {
      lines: linesOf(result),
      expectedTotal: Cents.of(result.totalCents),
    });
    expect(bought).toMatchObject(err({ kind: "InsufficientFunds" }));
    // No money moved. (The $50 starting grant is credited when the wallet first opens, which
    // was inside this purchase, so it rolled back too and is credited again next time.)
    expect(
      await count("ledger_entries", `user_id = '${jack.userId}' and kind = 'purchase_single'`),
    ).toBe(0);
    expect(await count("collection_cards", `user_id = '${jack.userId}'`)).toBe(0);
    expect(await count("store_transactions", `user_id = '${jack.userId}'`)).toBe(0);
    expect(await count("acquisitions", `user_id = '${jack.userId}'`)).toBe(0);
  });
});
