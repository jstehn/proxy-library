import type { Actor } from "@/modules/accounts";
import { receiveCardBatches } from "@/modules/collection";
import { spend, type InsufficientFunds } from "@/modules/wallet";
import { Cents, err, ok, type Result } from "@/shared/kernel";
import type {
  LineNotForSale,
  ListEmpty,
  ListTooLong,
  PricesChanged,
  QuantityInvalid,
} from "../domain/errors";
import { checkQuantity, totalPrice } from "../domain/pricing";
import { MAX_LIST_LINES } from "../domain/shopping-list";
import { quoteKey, type StoreDependencies } from "./ports";
import type { CheckedQuote, SingleInput } from "./singles";

// Buying a list of singles at once (design doc 15, section 3.4): all of it or nothing, at the
// price the player saw or less.

export type BuyListInput = Readonly<{
  lines: readonly SingleInput[];
  /** The total the player confirmed. If prices rose since, nothing is bought. */
  expectedTotal: Cents;
}>;

export type ListReceipt = Readonly<{ cards: number; total: Cents; transactionIds: number[] }>;

export type BuyListError =
  ListEmpty | ListTooLong | QuantityInvalid | LineNotForSale | PricesChanged | InsufficientFunds;

export function makeBuyList(dependencies: StoreDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function buyList(
    actor: Actor,
    input: BuyListInput,
  ): Promise<Result<ListReceipt, BuyListError>> {
    if (input.lines.length === 0) return err({ kind: "ListEmpty" });
    if (input.lines.length > MAX_LIST_LINES)
      return err({ kind: "ListTooLong", max: MAX_LIST_LINES });
    for (const line of input.lines) {
      const quantity = checkQuantity(line.quantity);
      if (!quantity.ok) return quantity;
    }

    return unitOfWork.run<ListReceipt, BuyListError>(async (services) => {
      // Price every line in one batched query first, so nothing is bought unless all of it can be.
      const quotedByKey = await services.marketPrices.quoteMany(input.lines);
      const quotes: CheckedQuote[] = [];
      for (const [index, line] of input.lines.entries()) {
        const quote = quotedByKey.get(quoteKey(line.printingId, line.finish));
        if (quote === undefined || !quote.isSetEnabled) {
          return err({ kind: "LineNotForSale", line: index });
        }
        quotes.push(quote);
      }
      const lineTotals = input.lines.map((line, index) =>
        totalPrice(quotes[index].price, line.quantity),
      );
      const total = Cents.sum(lineTotals);
      if (total > input.expectedTotal) return err({ kind: "PricesChanged", total });

      const now = clock.now();
      const transactionIds = await services.storeLedger.recordSingles(
        input.lines.map((line, index) => ({
          userId: actor.userId,
          direction: "buy" as const,
          printingId: line.printingId,
          finish: line.finish,
          quantity: line.quantity,
          unitMarket: quotes[index].price,
          rateBps: 10_000,
          unitPrice: quotes[index].price,
          total: lineTotals[index],
          priceDay: quotes[index].day,
          at: now,
        })),
      );
      for (const [index, lineTotal] of lineTotals.entries()) {
        // Rule 4: each line is recorded in the wallet ledger like a single purchase.
        const paid = await spend(services, {
          userId: actor.userId,
          amount: lineTotal,
          kind: "purchase_single",
          note: null,
          ref: `store:${transactionIds[index]}`,
          now,
        });
        if (!paid.ok) return paid;
      }

      await receiveCardBatches(
        services,
        actor.userId,
        input.lines.map((line, index) => ({
          gains: [{ printingId: line.printingId, finish: line.finish, quantity: line.quantity }],
          acquisition: { source: "store" as const, ref: `store:${transactionIds[index]}`, at: now },
        })),
      );
      const cards = input.lines.reduce((sum, line) => sum + line.quantity, 0);
      return ok({ cards, total, transactionIds });
    });
  }

  return buyList;
}
