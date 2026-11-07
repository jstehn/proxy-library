import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Cents, UserId } from "@/shared/kernel";
import {
  countAtTarget,
  paydaysToGo,
  totals,
  wishLines,
  type Offer,
  type WalletOutlook,
  type WishlistAnswers,
} from "./lines";
import { WishId, type Wish, type WishTarget } from "./wish";

// The Wishlist page's lines (design doc 26, sections 3 and 9).

const CLEAVER = "cleaver-oracle";
const jack = UserId.of("jack");

function offer(
  printingId: string,
  finish: Offer["finish"],
  price: number,
  releaseDate = "2024-01-01",
): Offer {
  return {
    oracleId: CLEAVER,
    printingId,
    finish,
    name: "The Reaver Cleaver",
    setCode: printingId.toUpperCase(),
    setName: printingId,
    collectorNumber: "1",
    variantLabel: "",
    releaseDate,
    price: Cents.of(price),
  };
}

// The Reaver Cleaver as it's sold today: M3C is the cheapest nonfoil.
const FOR_SALE: readonly Offer[] = [
  offer("dmc", "nonfoil", 2762),
  offer("m3c", "nonfoil", 2384, "2024-08-02"),
  offer("m3c", "foil", 4100, "2024-08-02"),
  offer("dmcx", "nonfoil", 3109),
];

let nextId = 1;
function wish(target: WishTarget, changes: Partial<Wish> = {}): Wish {
  return {
    id: WishId.of(nextId++),
    userId: jack,
    target,
    quantity: 1,
    targetPrice: null,
    savedPrice: null,
    note: "",
    createdAt: new Date("2026-11-01T00:00:00Z"),
    ...changes,
  };
}

const ANY: WishTarget = { kind: "anyPrinting", oracleId: CLEAVER, finish: "nonfoil" };

function answers(wishes: Wish[], owned: WishlistAnswers["owned"] = []): WishlistAnswers {
  return { wishes, names: new Map([[CLEAVER, "The Reaver Cleaver"]]), forSale: FOR_SALE, owned };
}

const outlook = (balance: number, allowance = 0): WalletOutlook => ({
  balance: Cents.of(balance),
  allowance: Cents.of(allowance),
  allowancePeriodDays: 7,
  nextPayday: new Date("2026-11-09T00:00:00Z"),
});

describe("wishLines", () => {
  it("offers the cheapest printing for sale in the wished finish, with the others as options", () => {
    const [line] = wishLines(answers([wish(ANY)]), outlook(0));
    expect(line.offer?.printingId).toBe("m3c");
    expect(line.options.map((option) => option.printingId)).toEqual(["m3c", "dmc", "dmcx"]);
  });

  it("'foil' takes only foil copies, 'cheapest' takes either finish", () => {
    const foil = wish({ ...ANY, finish: "foil" });
    const either = wish({ ...ANY, finish: "cheapest" });
    const [foilLine, eitherLine] = [foil, either].map(
      (one) => wishLines(answers([one]), outlook(0))[0],
    );
    expect(foilLine.options.map((option) => option.finish)).toEqual(["foil"]);
    expect(eitherLine.options).toHaveLength(4);
  });

  it("an exact wish only offers that printing in that finish", () => {
    const exact = wish({
      kind: "exactPrinting",
      oracleId: CLEAVER,
      printingId: "dmc",
      finish: "nonfoil",
    });
    const [line] = wishLines(answers([exact]), outlook(0));
    expect(line.options.map((option) => option.printingId)).toEqual(["dmc"]);
  });

  it("is short by the price less the balance, and counts paydays when allowances are on", () => {
    const [off] = wishLines(answers([wish(ANY)]), outlook(2000));
    expect(off.status).toEqual({ kind: "shortBy", shortfall: 384, paydays: null });

    const [on] = wishLines(answers([wish(ANY)]), outlook(2000, 250));
    // $3.84 short at $2.50 a week: two paydays, the 9th and the 16th.
    expect(on.status).toEqual({
      kind: "shortBy",
      shortfall: 384,
      paydays: { count: 2, date: new Date("2026-11-16T00:00:00Z") },
    });
  });

  it("counts any copy of the card for 'any printing', but only that printing for an exact wish", () => {
    const owned = [{ oracleId: CLEAVER, printingId: "dmc", finish: "foil" as const, quantity: 1 }];
    const exact = wish({
      kind: "exactPrinting",
      oracleId: CLEAVER,
      printingId: "dmc",
      finish: "nonfoil",
    });
    const lines = wishLines(answers([wish(ANY, { quantity: 2 }), exact], owned), outlook(0));
    const anyLine = lines.find((line) => line.wish.target.kind === "anyPrinting");
    const exactLine = lines.find((line) => line.wish.target.kind === "exactPrinting");
    expect([anyLine?.owned, anyLine?.missing, anyLine?.total]).toEqual([1, 1, 2384]);
    expect([exactLine?.owned, exactLine?.missing]).toEqual([0, 1]);
  });

  it("shows a wish filled some other way as fulfilled, never at target", () => {
    const owned = [
      { oracleId: CLEAVER, printingId: "m3c", finish: "nonfoil" as const, quantity: 1 },
    ];
    const [line] = wishLines(
      answers([wish(ANY, { targetPrice: Cents.of(9999) })], owned),
      outlook(0),
    );
    expect(line.status).toEqual({ kind: "fulfilled" });
    expect(line.atTarget).toBe(false);
  });

  it("says how the price moved since it was saved", () => {
    const [line] = wishLines(answers([wish(ANY, { savedPrice: Cents.of(2500) })]), outlook(0));
    expect(line.changeSinceSaved).toBe(-116);
  });

  it("is not for sale when no printing fits, and keeps the card's name", () => {
    const etched = wish({
      kind: "exactPrinting",
      oracleId: CLEAVER,
      printingId: "dmc",
      finish: "etched",
    });
    const [line] = wishLines(answers([etched]), outlook(0));
    expect([line.status.kind, line.name, line.total]).toEqual([
      "notForSale",
      "The Reaver Cleaver",
      null,
    ]);
  });

  it("orders: at target, affordable, smallest shortfall, not for sale, fulfilled", () => {
    const other = "other-oracle";
    const owned = [{ oracleId: other, printingId: "x", finish: "nonfoil" as const, quantity: 1 }];
    const lines = wishLines(
      answers(
        [
          wish({ kind: "anyPrinting", oracleId: other, finish: "nonfoil" }, { note: "fulfilled" }),
          wish({ ...ANY, finish: "cheapest" }, { quantity: 3, note: "short by a lot" }),
          wish(
            { kind: "exactPrinting", oracleId: CLEAVER, printingId: "dmc", finish: "etched" },
            { note: "not for sale" },
          ),
          wish({ ...ANY, finish: "foil" }, { note: "short by a little" }),
          wish(ANY, { note: "affordable" }),
          wish(
            { kind: "exactPrinting", oracleId: CLEAVER, printingId: "dmcx", finish: "nonfoil" },
            {
              targetPrice: Cents.of(3200),
              note: "at target",
            },
          ),
        ],
        owned,
      ),
      outlook(3000),
    );
    expect(lines.map((line) => line.wish.note)).toEqual([
      "at target",
      "affordable",
      "short by a little",
      "short by a lot",
      "not for sale",
      "fulfilled",
    ]);
  });
});

describe("countAtTarget and totals", () => {
  it("counts wishes at or under their target and adds up what's missing", () => {
    const list = answers([
      wish(ANY, { targetPrice: Cents.of(2384) }),
      wish({ ...ANY, finish: "foil" }, { targetPrice: Cents.of(4000) }),
    ]);
    expect(countAtTarget(list)).toBe(1);
    expect(totals(wishLines(list, outlook(3000)))).toEqual({ all: 2384 + 4100, affordable: 2384 });
  });
});

describe("paydaysToGo", () => {
  const shortfall = fc.integer({ min: 1, max: 1_000_000 });
  const allowance = fc.integer({ min: 1, max: 100_000 });

  it("is null when allowances are off", () => {
    expect(paydaysToGo(Cents.of(100), outlook(0, 0))).toBeNull();
  });

  it("covers the shortfall, and one payday fewer wouldn't", () => {
    fc.assert(
      fc.property(shortfall, allowance, (short, weekly) => {
        const paydays = paydaysToGo(Cents.of(short), outlook(0, weekly));
        if (paydays === null) return false;
        return paydays.count * weekly >= short && (paydays.count - 1) * weekly < short;
      }),
    );
  });

  it("never needs more paydays with a bigger allowance", () => {
    fc.assert(
      fc.property(shortfall, allowance, allowance, (short, a, b) => {
        const [smaller, larger] = a <= b ? [a, b] : [b, a];
        const fewer = paydaysToGo(Cents.of(short), outlook(0, larger));
        const more = paydaysToGo(Cents.of(short), outlook(0, smaller));
        return fewer !== null && more !== null && fewer.count <= more.count;
      }),
    );
  });
});
