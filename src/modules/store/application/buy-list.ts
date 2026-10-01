import type { Actor } from "@/modules/accounts";
import type { InsufficientFunds } from "@/modules/wallet";
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
import type { StoreDependencies } from "./ports";
import { buyCopies, type CheckedQuote, type SingleInput } from "./singles";

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
      // Price every line first, so nothing is bought unless all of it can be (rules 1 and 2).
      const quotes: CheckedQuote[] = [];
      for (const [index, line] of input.lines.entries()) {
        const quote = await services.marketPrices.quote(line.printingId, line.finish);
        if (quote === null || !quote.isSetEnabled)
          return err({ kind: "LineNotForSale", line: index });
        quotes.push(quote);
      }
      const total = Cents.sum(
        input.lines.map((line, index) => totalPrice(quotes[index].price, line.quantity)),
      );
      if (total > input.expectedTotal) return err({ kind: "PricesChanged", total });

      const now = clock.now();
      const transactionIds: number[] = [];
      for (const [index, line] of input.lines.entries()) {
        // The wallet refuses once the money runs out; returning the error undoes every line.
        const bought = await buyCopies(services, { actor, line, quote: quotes[index], now });
        if (!bought.ok) return bought;
        transactionIds.push(bought.value.transactionId);
      }
      const cards = input.lines.reduce((sum, line) => sum + line.quantity, 0);
      return ok({ cards, total, transactionIds });
    });
  }

  return buyList;
}
