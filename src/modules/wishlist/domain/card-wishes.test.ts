import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { planCardWishes } from "./card-wishes";
import { WishId, type Wish, type WishTarget } from "./wish";

// Wishing for many cards at once (task 71).

function wish(id: number, target: WishTarget, quantity: number): Wish {
  return {
    id: WishId.of(id),
    userId: UserId.of("jack"),
    target,
    quantity,
    targetPrice: null,
    note: "",
    savedPrice: null,
    createdAt: new Date("2026-11-10T00:00:00Z"),
  };
}

const cheapest = (oracleId: string): WishTarget => ({
  kind: "anyPrinting",
  oracleId,
  finish: "cheapest",
});

describe("planCardWishes", () => {
  it("adds a wish for each card nobody wished for", () => {
    const plan = planCardWishes(
      [
        { oracleId: "bolt", quantity: 4 },
        { oracleId: "sol-ring", quantity: 1 },
      ],
      [],
      500,
    );
    expect(plan).toEqual({
      add: [
        { oracleId: "bolt", quantity: 4 },
        { oracleId: "sol-ring", quantity: 1 },
      ],
      raise: [],
      unchanged: 0,
      skipped: 0,
    });
  });

  it("raises a cheapest wish that wants fewer copies, and keeps one that wants enough", () => {
    const plan = planCardWishes(
      [
        { oracleId: "bolt", quantity: 4 },
        { oracleId: "sol-ring", quantity: 1 },
      ],
      [wish(1, cheapest("bolt"), 2), wish(2, cheapest("sol-ring"), 3)],
      500,
    );
    expect(plan).toEqual({
      add: [],
      raise: [{ wishId: 1, quantity: 4 }],
      unchanged: 1,
      skipped: 0,
    });
  });

  it("leaves a card alone when the player chose a finish or a printing for it", () => {
    const foil: WishTarget = { kind: "anyPrinting", oracleId: "bolt", finish: "foil" };
    const exact: WishTarget = {
      kind: "exactPrinting",
      oracleId: "sol-ring",
      printingId: "c21-263",
      finish: "nonfoil",
    };
    const plan = planCardWishes(
      [
        { oracleId: "bolt", quantity: 4 },
        { oracleId: "sol-ring", quantity: 2 },
      ],
      [wish(1, foil, 1), wish(2, exact, 1)],
      500,
    );
    expect(plan).toEqual({ add: [], raise: [], unchanged: 2, skipped: 0 });
  });

  it("adds only as many as fit on the wishlist (rule 2)", () => {
    const plan = planCardWishes(
      [
        { oracleId: "a", quantity: 1 },
        { oracleId: "b", quantity: 1 },
        { oracleId: "c", quantity: 1 },
      ],
      [],
      1,
    );
    expect(plan).toMatchObject({ add: [{ oracleId: "a", quantity: 1 }], skipped: 2 });
  });

  it("merges repeated cards at the largest count, caps it at 99, and drops zero", () => {
    const plan = planCardWishes(
      [
        { oracleId: "bolt", quantity: 2 },
        { oracleId: "bolt", quantity: 3 },
        { oracleId: "relentless-rats", quantity: 120 },
        { oracleId: "owned-already", quantity: 0 },
      ],
      [],
      500,
    );
    expect(plan.add).toEqual([
      { oracleId: "bolt", quantity: 3 },
      { oracleId: "relentless-rats", quantity: 99 },
    ]);
  });
});
