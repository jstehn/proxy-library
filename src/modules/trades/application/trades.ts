import type { Actor } from "@/modules/accounts";
import { recordEvent } from "@/modules/activity";
import { giveUpCards, receiveCards, type CardGain } from "@/modules/collection";
import { lockWallets, receive, spend } from "@/modules/wallet";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type {
  AlreadyDecided,
  CannotTradeWithYourself,
  NoLongerPossible,
  OfferInvalid,
  OfferNotPossible,
  PlayerNotFound,
  Shortfall,
  TradeNotFound,
} from "../domain/errors";
import {
  checkMessage,
  checkOffer,
  decide,
  type Trade,
  type TradeId,
  type TradeItem,
  type TradeSide,
} from "../domain/trade";
import type { TradesDependencies, TradesServices } from "./ports";

// Trade use cases (design doc 10, section 6).

export type ProposeInput = Readonly<{
  recipientId: UserId;
  items: readonly TradeItem[];
  message: string;
}>;

export type ProposeTradeError =
  CannotTradeWithYourself | PlayerNotFound | OfferInvalid | OfferNotPossible;
export type DecideError = TradeNotFound | AlreadyDecided;
export type AcceptTradeError = DecideError | NoLongerPossible;
export type CounterTradeError = DecideError | ProposeTradeError;

/** Who gives, and who receives, for items from one side. */
function parties(trade: Pick<Trade, "proposerId" | "recipientId">, side: TradeSide) {
  return side === "proposer"
    ? { giver: trade.proposerId, taker: trade.recipientId }
    : { giver: trade.recipientId, taker: trade.proposerId };
}

/** Rule 3: does each side have what it offers, right now? (Nothing is reserved.) */
async function firstShortfall(
  services: TradesServices,
  trade: Pick<Trade, "proposerId" | "recipientId">,
  items: readonly TradeItem[],
): Promise<Shortfall | null> {
  for (const item of items) {
    const { giver } = parties(trade, item.from);
    if (item.kind === "card") {
      const owned = await services.holdings.copies(giver, item.printingId, item.finish);
      if (owned < item.quantity) {
        return {
          what: "cards",
          side: item.from,
          printingId: item.printingId,
          finish: item.finish,
          owned,
          needed: item.quantity,
        };
      }
    } else {
      const balance = await services.wallets.balance(giver);
      if (balance < item.amount)
        return { what: "money", side: item.from, balance, needed: item.amount };
    }
  }
  return null;
}

async function propose(
  services: TradesServices,
  actor: Actor,
  input: ProposeInput,
  now: Date,
  replacesId: TradeId | null,
): Promise<Result<TradeId, ProposeTradeError>> {
  if (input.recipientId === actor.userId) return err({ kind: "CannotTradeWithYourself" });
  const items = checkOffer(input.items);
  if (!items.ok) return items;
  const message = checkMessage(input.message);
  if (!message.ok) return message;
  if (!(await services.tradePlayers.isActive(input.recipientId)))
    return err({ kind: "PlayerNotFound" });

  const trade = { proposerId: actor.userId, recipientId: input.recipientId };
  const shortfall = await firstShortfall(services, trade, items.value);
  if (shortfall !== null) return err({ kind: "OfferNotPossible", shortfall });

  return ok(
    await services.trades.create({
      ...trade,
      items: items.value,
      message: message.value,
      replacesId,
      createdAt: now,
    }),
  );
}

/**
 * Moves everything in an accepted trade (rules 4 and 5). Money first, then cards; any shortfall
 * returns an error, and the caller's transaction rolls back everything already moved.
 */
async function carryOut(
  services: TradesServices,
  trade: Trade,
  now: Date,
): Promise<Result<void, NoLongerPossible>> {
  const ref = `trade:${trade.id}`;
  await lockWallets(services, [trade.proposerId, trade.recipientId], now);

  for (const item of trade.items) {
    if (item.kind !== "money") continue;
    const { giver, taker } = parties(trade, item.from);
    const paid = await spend(services, {
      userId: giver,
      amount: item.amount,
      kind: "trade_out",
      note: null,
      ref,
      now,
    });
    if (!paid.ok) {
      return err({
        kind: "NoLongerPossible",
        shortfall: {
          what: "money",
          side: item.from,
          balance: paid.error.balance,
          needed: item.amount,
        },
      });
    }
    await receive(services, {
      userId: taker,
      amount: item.amount,
      kind: "trade_in",
      note: null,
      ref,
      now,
    });
  }

  for (const side of ["proposer", "recipient"] as const) {
    const cards: CardGain[] = trade.items.flatMap((item) =>
      item.kind === "card" && item.from === side
        ? [{ printingId: item.printingId, finish: item.finish, quantity: item.quantity }]
        : [],
    );
    if (cards.length === 0) continue;
    const { giver, taker } = parties(trade, side);
    const given = await giveUpCards(services, giver, cards, { source: "trade", ref, at: now });
    if (!given.ok) {
      const { printingId, finish, owned, needed } = given.error;
      return err({
        kind: "NoLongerPossible",
        shortfall: { what: "cards", side, printingId, finish, owned, needed },
      });
    }
    await receiveCards(services, taker, cards, { source: "trade", ref, at: now });
  }
  return ok();
}

export function makeTrades(dependencies: TradesDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function proposeTrade(
    actor: Actor,
    input: ProposeInput,
  ): Promise<Result<TradeId, ProposeTradeError>> {
    return unitOfWork.run<TradeId, ProposeTradeError>((services) =>
      propose(services, actor, input, clock.now(), null),
    );
  }

  async function acceptTrade(
    actor: Actor,
    tradeId: TradeId,
  ): Promise<Result<void, AcceptTradeError>> {
    return unitOfWork.run<void, AcceptTradeError>(async (services) => {
      const now = clock.now();
      const decided = decide(await services.trades.lock(tradeId), actor.userId, "accept", now);
      if (!decided.ok) return decided;
      const done = await carryOut(services, decided.value, now);
      if (!done.ok) return done; // rolls back: nothing moved, the trade stays proposed
      await services.trades.decide(decided.value);
      // The feed says who traded and how many cards, not what or for how much (decision 2).
      await recordEvent(
        services,
        {
          kind: "trade",
          actorId: actor.userId,
          otherId: decided.value.proposerId,
          cardsMoved: decided.value.items.reduce(
            (total, item) => total + (item.kind === "card" ? item.quantity : 0),
            0,
          ),
          moneyChanged: decided.value.items.some((item) => item.kind === "money"),
        },
        now,
      );
      return ok();
    });
  }

  /** Decline (the recipient) or cancel (the proposer): nothing moves. */
  function makeEnding(event: "decline" | "cancel") {
    async function end(actor: Actor, tradeId: TradeId): Promise<Result<void, DecideError>> {
      return unitOfWork.run<void, DecideError>(async ({ trades }) => {
        const decided = decide(await trades.lock(tradeId), actor.userId, event, clock.now());
        if (!decided.ok) return decided;
        await trades.decide(decided.value);
        return ok();
      });
    }
    return end;
  }

  /** The recipient answers with different terms: this trade becomes "countered", and a new one goes back. */
  async function counterTrade(
    actor: Actor,
    tradeId: TradeId,
    input: Omit<ProposeInput, "recipientId">,
  ): Promise<Result<TradeId, CounterTradeError>> {
    return unitOfWork.run<TradeId, CounterTradeError>(async (services) => {
      const now = clock.now();
      const decided = decide(await services.trades.lock(tradeId), actor.userId, "counter", now);
      if (!decided.ok) return decided;
      await services.trades.decide(decided.value);
      return propose(
        services,
        actor,
        { ...input, recipientId: decided.value.proposerId },
        now,
        tradeId,
      );
    });
  }

  return {
    proposeTrade,
    acceptTrade,
    declineTrade: makeEnding("decline"),
    cancelTrade: makeEnding("cancel"),
    counterTrade,
  };
}

export type Trades = ReturnType<typeof makeTrades>;
