import type { Actor } from "@/modules/accounts";
import type { Finish, PrintingId } from "@/modules/catalog";
import { giveUpCards, receiveCards, type NotEnoughCopies } from "@/modules/collection";
import { receive, spend, type InsufficientFunds } from "@/modules/wallet";
import { err, ok, type Cents, type Result } from "@/shared/kernel";
import type {
  Forbidden,
  NoPrice,
  NotBuying,
  NotForSale,
  QuantityInvalid,
  RateInvalid,
  WorthNothing,
} from "../domain/errors";
import { checkQuantity, totalPrice } from "../domain/pricing";
import { checkRate, FULL_RATE_BPS, payoutPerCopy } from "../domain/singles";
import type { StoreDependencies, StoreServices } from "./ports";

// Buying and selling single cards (design doc 07, section 5). Each is one transaction across
// the store's records, the wallet and the collection.

export type SingleInput = Readonly<{ printingId: PrintingId; finish: Finish; quantity: number }>;

export type SingleReceipt = Readonly<{
  transactionId: number;
  unitPrice: Cents;
  total: Cents;
  priceDay: string;
}>;

export type BuySingleError = NotForSale | NoPrice | QuantityInvalid | InsufficientFunds;
export type SellSingleError =
  NoPrice | QuantityInvalid | NotEnoughCopies | WorthNothing | NotBuying;

/** A price the store has checked: the market quote that a purchase is recorded at. */
export type CheckedQuote = Readonly<{ price: Cents; day: string }>;

/**
 * The heart of buying singles, shared by buying one card and buying a list (design doc 15,
 * rule 4): one store record, one wallet entry linked to it, and the cards. Runs inside the
 * caller's transaction; an error leaves the caller to return it, which rolls everything back.
 */
export async function buyCopies(
  services: StoreServices,
  input: Readonly<{
    actor: Actor;
    line: SingleInput;
    quote: CheckedQuote;
    now: Date;
  }>,
): Promise<Result<SingleReceipt, InsufficientFunds>> {
  const { actor, line, quote, now } = input;
  const total = totalPrice(quote.price, line.quantity);
  const transactionId = await services.storeLedger.recordSingle({
    userId: actor.userId,
    direction: "buy",
    printingId: line.printingId,
    finish: line.finish,
    quantity: line.quantity,
    unitMarket: quote.price,
    rateBps: FULL_RATE_BPS,
    unitPrice: quote.price,
    total,
    priceDay: quote.day,
    at: now,
  });
  const ref = `store:${transactionId}`;

  const paid = await spend(services, {
    userId: actor.userId,
    amount: total,
    kind: "purchase_single",
    note: null,
    ref,
    now,
  });
  if (!paid.ok) return paid;

  await receiveCards(
    services,
    actor.userId,
    [{ printingId: line.printingId, finish: line.finish, quantity: line.quantity }],
    { source: "store", ref, at: now },
  );
  return ok({ transactionId, unitPrice: quote.price, total, priceDay: quote.day });
}

/** A player buys copies of one printing, in one finish, at market price (rules 1, 2, 7). */
export function makeBuySingle(dependencies: StoreDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function buySingle(
    actor: Actor,
    input: SingleInput,
  ): Promise<Result<SingleReceipt, BuySingleError>> {
    const quantity = checkQuantity(input.quantity);
    if (!quantity.ok) return quantity;

    return unitOfWork.run<SingleReceipt, BuySingleError>(async (services) => {
      const quote = await services.marketPrices.quote(input.printingId, input.finish);
      if (quote === null) return err({ kind: "NoPrice" });
      if (!quote.isSetEnabled) return err({ kind: "NotForSale" });
      // The store record rolls back too when the wallet can't pay.
      return buyCopies(services, {
        actor,
        line: { ...input, quantity: quantity.value },
        quote,
        now: clock.now(),
      });
    });
  }

  return buySingle;
}

/** A player sells copies they own to the store at the buylist rate (rules 3–5). */
export function makeSellSingle(dependencies: StoreDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function sellSingle(
    actor: Actor,
    input: SingleInput,
  ): Promise<Result<SingleReceipt, SellSingleError>> {
    const quantity = checkQuantity(input.quantity);
    if (!quantity.ok) return quantity;

    return unitOfWork.run<SingleReceipt, SellSingleError>(async (services) => {
      const rateBps = await services.storeSettings.buylistRate();
      if (rateBps === 0) return err({ kind: "NotBuying" });
      const quote = await services.marketPrices.quote(input.printingId, input.finish);
      if (quote === null) return err({ kind: "NoPrice" });
      const unitPrice = payoutPerCopy(quote.price, rateBps);
      if (unitPrice === 0) return err({ kind: "WorthNothing" });

      const now = clock.now();
      const total = totalPrice(unitPrice, quantity.value);
      const transactionId = await services.storeLedger.recordSingle({
        userId: actor.userId,
        direction: "sell",
        printingId: input.printingId,
        finish: input.finish,
        quantity: quantity.value,
        unitMarket: quote.price,
        rateBps,
        unitPrice,
        total,
        priceDay: quote.day,
        at: now,
      });
      const ref = `store:${transactionId}`;

      // Take the cards first: if they don't own enough, everything rolls back.
      const given = await giveUpCards(
        services,
        actor.userId,
        [{ printingId: input.printingId, finish: input.finish, quantity: quantity.value }],
        { source: "sale", ref, at: now },
      );
      if (!given.ok) return given;

      await receive(services, {
        userId: actor.userId,
        amount: total,
        kind: "sellback",
        note: null,
        ref,
        now,
      });
      return ok({ transactionId, unitPrice, total, priceDay: quote.day });
    });
  }

  return sellSingle;
}

/** An admin sets how much of market price the store pays for cards (rule 5). */
export function makeSetBuylistRate(dependencies: StoreDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function setBuylistRate(
    actor: Actor,
    rateBps: number,
  ): Promise<Result<void, Forbidden | RateInvalid>> {
    if (!actor.isAdmin) return err({ kind: "Forbidden" });
    const rate = checkRate(rateBps);
    if (!rate.ok) return rate;
    return unitOfWork.run<void, Forbidden | RateInvalid>(async ({ storeSettings }) => {
      await storeSettings.setBuylistRate(rate.value, actor.userId, clock.now());
      return ok();
    });
  }

  return setBuylistRate;
}
