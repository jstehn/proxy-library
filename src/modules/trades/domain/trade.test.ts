import { describe, expect, it } from "vitest";
import { Cents, err, ok, UserId } from "@/shared/kernel";
import { tradeCard } from "../testing/fakes";
import { checkOffer, decide, TradeId, type Trade } from "./trade";

const alice = UserId.of("alice");
const bob = UserId.of("bob");
const now = new Date("2026-09-27T12:00:00Z");
const money = (from: "proposer" | "recipient", cents: number) => ({
  kind: "money" as const,
  from,
  amount: Cents.of(cents),
});

describe("checkOffer (rule 1)", () => {
  it("combines the same card from the same side", () => {
    expect(
      checkOffer([tradeCard("proposer", "bolt", 2), tradeCard("proposer", "bolt", 1)]),
    ).toEqual(ok([tradeCard("proposer", "bolt", 3)]));
  });

  it("keeps the two sides apart", () => {
    const offer = checkOffer([
      tradeCard("proposer", "bolt"),
      tradeCard("recipient", "bolt"),
      money("recipient", 500),
    ]);
    expect(offer.ok && offer.value).toHaveLength(3);
  });

  it("refuses an empty offer, bad quantities, bad amounts and two amounts from one side", () => {
    expect(checkOffer([]).ok).toBe(false);
    expect(checkOffer([tradeCard("proposer", "bolt", 0)]).ok).toBe(false);
    expect(
      checkOffer([tradeCard("proposer", "bolt", 60), tradeCard("proposer", "bolt", 40)]).ok,
    ).toBe(false);
    expect(checkOffer([money("proposer", 0)]).ok).toBe(false);
    expect(checkOffer([money("proposer", 1_000_001)]).ok).toBe(false);
    expect(checkOffer([money("proposer", 100), money("proposer", 100)])).toEqual(
      err({ kind: "OfferInvalid", reason: "one amount of money per side" }),
    );
  });
});

describe("decide (the state machine, section 4)", () => {
  const trade: Trade = {
    id: TradeId.of(1),
    proposerId: alice,
    recipientId: bob,
    status: "proposed",
    items: [tradeCard("proposer", "bolt")],
    message: "",
    replacesId: null,
    createdAt: now,
    decidedAt: null,
  };

  it("lets the recipient accept, decline or counter, and the proposer cancel", () => {
    expect(decide(trade, bob, "accept", now)).toEqual(
      ok({ ...trade, status: "accepted", decidedAt: now }),
    );
    expect(decide(trade, bob, "decline", now).ok).toBe(true);
    expect(
      decide(trade, bob, "counter", now).ok && decide(trade, bob, "counter", now),
    ).toMatchObject({ value: { status: "countered" } });
    expect(decide(trade, alice, "cancel", now).ok).toBe(true);
  });

  it("refuses the wrong side, and strangers, as if the trade didn't exist", () => {
    const notFound = err({ kind: "TradeNotFound" });
    expect(decide(trade, alice, "accept", now)).toEqual(notFound);
    expect(decide(trade, bob, "cancel", now)).toEqual(notFound);
    expect(decide(trade, UserId.of("mallory"), "accept", now)).toEqual(notFound);
    expect(decide(null, bob, "accept", now)).toEqual(notFound);
  });

  it("decides only once", () => {
    const accepted = { ...trade, status: "accepted" as const, decidedAt: now };
    expect(decide(accepted, bob, "decline", now)).toEqual(
      err({ kind: "AlreadyDecided", status: "accepted" }),
    );
  });
});
