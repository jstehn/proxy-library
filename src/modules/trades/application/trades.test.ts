import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { inMemoryEventRecorder } from "@/modules/activity/testing/fakes";
import { inMemoryCollectionRepository, sampleGain } from "@/modules/collection/testing/fakes";
import { inMemoryWalletServices } from "@/modules/wallet/testing/fakes";
import { Cents, err, UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import {
  holdingsFrom,
  inMemoryTradePlayers,
  inMemoryTradeRepository,
  tradeCard,
} from "../testing/fakes";
import { makeTrades } from "./trades";

function actor(id: string): Actor {
  return {
    userId: UserId.of(id),
    username: id as Actor["username"],
    displayName: id as Actor["displayName"],
    isAdmin: false,
    canSelfFund: false,
    mustChangePassword: false,
  };
}

const alice = actor("alice");
const bob = actor("bob");
const now = new Date("2026-01-07T10:00:00Z");
const money = (from: "proposer" | "recipient", cents: number) => ({
  kind: "money" as const,
  from,
  amount: Cents.of(cents),
});

let wallet: ReturnType<typeof inMemoryWalletServices>;
let collection: ReturnType<typeof inMemoryCollectionRepository>;
let repository: ReturnType<typeof inMemoryTradeRepository>;
let trades: ReturnType<typeof makeTrades>;
let events: ReturnType<typeof inMemoryEventRecorder>;

beforeEach(async () => {
  wallet = inMemoryWalletServices(["alice", "bob"]);
  collection = inMemoryCollectionRepository();
  repository = inMemoryTradeRepository();
  events = inMemoryEventRecorder();
  const services = {
    events,
    ...wallet.services,
    collection,
    trades: repository,
    tradePlayers: inMemoryTradePlayers(["alice", "bob"]),
    holdings: holdingsFrom(collection.quantity),
  };
  trades = makeTrades({ unitOfWork: inMemoryUnitOfWork(services), clock: fixedClock(now) });
  // Alice has 2 Bolts, Bob has a Sol Ring; both wallets open with $50.
  await collection.receive(alice.userId, [sampleGain("bolt", 2)], {
    source: "store",
    ref: "x",
    at: now,
  });
  await collection.receive(bob.userId, [sampleGain("ring", 1)], {
    source: "store",
    ref: "x",
    at: now,
  });
  for (const player of [alice, bob])
    await wallet.services.wallets.openAccountIfMissing({
      userId: player.userId,
      allowancePaidThrough: now,
      openedAt: now,
    });
  await wallet.services.wallets.appendEntries([
    {
      userId: alice.userId,
      amount: Cents.of(5000),
      kind: "grant",
      note: null,
      createdBy: null,
      effectiveAt: now,
      ref: null,
    },
    {
      userId: bob.userId,
      amount: Cents.of(5000),
      kind: "grant",
      note: null,
      createdBy: null,
      effectiveAt: now,
      ref: null,
    },
  ]);
});

async function propose(items: Parameters<typeof trades.proposeTrade>[1]["items"]) {
  const result = await trades.proposeTrade(alice, {
    recipientId: bob.userId,
    items,
    message: "deal?",
  });
  if (!result.ok) throw new Error(result.error.kind);
  return result.value;
}

const balance = (player: Actor) => wallet.services.wallets.balance(player.userId);

describe("proposeTrade", () => {
  it("refuses yourself, strangers, and offers you can't make (rules 2, 3)", async () => {
    expect(
      await trades.proposeTrade(alice, {
        recipientId: alice.userId,
        items: [tradeCard("proposer", "bolt")],
        message: "",
      }),
    ).toEqual(err({ kind: "CannotTradeWithYourself" }));
    expect(
      await trades.proposeTrade(alice, {
        recipientId: UserId.of("nobody"),
        items: [tradeCard("proposer", "bolt")],
        message: "",
      }),
    ).toEqual(err({ kind: "PlayerNotFound" }));
    expect(
      await trades.proposeTrade(alice, {
        recipientId: bob.userId,
        items: [tradeCard("proposer", "bolt", 3)],
        message: "",
      }),
    ).toEqual(
      err({
        kind: "OfferNotPossible",
        shortfall: {
          what: "cards",
          side: "proposer",
          printingId: "bolt",
          finish: "nonfoil",
          owned: 2,
          needed: 3,
        },
      }),
    );
    expect(
      await trades.proposeTrade(alice, {
        recipientId: bob.userId,
        items: [tradeCard("recipient", "bolt")],
        message: "",
      }),
    ).toMatchObject({
      ok: false,
      error: { kind: "OfferNotPossible", shortfall: { side: "recipient" } },
    });
  });
});

describe("acceptTrade (rules 4 and 5)", () => {
  it("moves every card and every cent, both ways, logged against the trade", async () => {
    const id = await propose([
      tradeCard("proposer", "bolt", 2),
      money("proposer", 300),
      tradeCard("recipient", "ring"),
    ]);
    expect(await trades.acceptTrade(bob, id)).toEqual({ ok: true, value: undefined });

    expect(collection.quantity(alice.userId, "bolt")).toBe(0);
    expect(collection.quantity(bob.userId, "bolt")).toBe(2);
    expect(collection.quantity(alice.userId, "ring")).toBe(1);
    expect(collection.quantity(bob.userId, "ring")).toBe(0);
    expect(await balance(alice)).toBe(4700);
    expect(await balance(bob)).toBe(5300);
    expect(repository.get(id)?.status).toBe("accepted");
    expect(events.recorded.map((entry) => entry.event)).toEqual([
      {
        kind: "trade",
        actorId: bob.userId,
        otherId: alice.userId,
        cardsMoved: 3,
        moneyChanged: true,
      },
    ]);
    expect(
      collection.log
        .filter((entry) => entry.source === "trade")
        .every((entry) => entry.ref === `trade:${id}`),
    ).toBe(true);
  });

  it("refuses when the proposer no longer has the cards, leaving the trade proposed", async () => {
    const id = await propose([tradeCard("proposer", "bolt", 2)]);
    await collection.remove(alice.userId, [sampleGain("bolt", 1)], {
      source: "sale",
      ref: "store:9",
      at: now,
    });
    expect(await trades.acceptTrade(bob, id)).toEqual(
      err({
        kind: "NoLongerPossible",
        shortfall: {
          what: "cards",
          side: "proposer",
          printingId: "bolt",
          finish: "nonfoil",
          owned: 1,
          needed: 2,
        },
      }),
    );
    expect(repository.get(id)?.status).toBe("proposed");
  });

  it("refuses when someone can no longer pay", async () => {
    const id = await propose([tradeCard("proposer", "bolt"), money("recipient", 5000)]);
    await wallet.services.wallets.appendEntries([
      {
        userId: bob.userId,
        amount: Cents.of(-100),
        kind: "correction",
        note: "x",
        createdBy: null,
        effectiveAt: now,
        ref: null,
      },
    ]);
    expect(await trades.acceptTrade(bob, id)).toMatchObject({
      ok: false,
      error: {
        kind: "NoLongerPossible",
        shortfall: { what: "money", side: "recipient", needed: 5000 },
      },
    });
  });

  it("can't be accepted twice, or by the proposer", async () => {
    const id = await propose([tradeCard("proposer", "bolt")]);
    expect(await trades.acceptTrade(alice, id)).toEqual(err({ kind: "TradeNotFound" }));
    await trades.acceptTrade(bob, id);
    expect(await trades.acceptTrade(bob, id)).toEqual(
      err({ kind: "AlreadyDecided", status: "accepted" }),
    );
  });
});

describe("decline, cancel and counter", () => {
  it("declines and cancels without moving anything", async () => {
    const first = await propose([tradeCard("proposer", "bolt")]);
    const second = await propose([tradeCard("proposer", "bolt")]);
    expect((await trades.declineTrade(bob, first)).ok).toBe(true);
    expect((await trades.cancelTrade(alice, second)).ok).toBe(true);
    expect(repository.get(first)?.status).toBe("declined");
    expect(repository.get(second)?.status).toBe("cancelled");
    expect(collection.quantity(alice.userId, "bolt")).toBe(2);
  });

  it("counters: the original is 'countered' and a new proposal goes the other way", async () => {
    const original = await propose([tradeCard("proposer", "bolt", 2)]);
    const counter = await trades.counterTrade(bob, original, {
      items: [tradeCard("proposer", "ring"), tradeCard("recipient", "bolt", 1)],
      message: "one Bolt?",
    });
    if (!counter.ok) throw new Error(counter.error.kind);
    expect(repository.get(original)?.status).toBe("countered");
    expect(repository.get(counter.value)).toMatchObject({
      proposerId: "bob",
      recipientId: "alice",
      replacesId: original,
      status: "proposed",
    });
    expect((await trades.acceptTrade(alice, counter.value)).ok).toBe(true);
    expect(collection.quantity(bob.userId, "bolt")).toBe(1);
  });
});
