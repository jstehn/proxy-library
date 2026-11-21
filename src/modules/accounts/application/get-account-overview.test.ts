import { describe, expect, it } from "vitest";
import { testActor } from "../testing/actors";
import { makeGetAccountOverview } from "./get-account-overview";

const readers = {
  refreshBalance: async () => 5000,
  allowance: async () => null,
  collectionTotals: async () => ({ differentCards: 2, copies: 5, valueCents: 120 }),
  deckCount: async () => 3,
  wishCount: async () => 4,
};

describe("getAccountOverview", () => {
  it("gathers the balance and totals", async () => {
    const getAccountOverview = makeGetAccountOverview(readers);
    expect(await getAccountOverview(testActor())).toEqual({
      ok: true,
      value: {
        balanceCents: 5000,
        allowance: null,
        collection: { differentCards: 2, copies: 5, valueCents: 120 },
        decks: 3,
        wishes: 4,
      },
    });
  });

  it("passes the allowance through when it is on", async () => {
    const next = new Date("2026-02-01T00:00:00Z");
    const allowance = { amountCents: 1000, everyDays: 7, next };
    const getAccountOverview = makeGetAccountOverview({
      ...readers,
      allowance: async () => allowance,
    });
    const result = await getAccountOverview(testActor());
    expect(result.ok && result.value.allowance).toEqual(allowance);
  });
});
