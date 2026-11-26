import type { Actor } from "@/modules/accounts";
import { giveUpCards, type NotEnoughCopies } from "@/modules/collection";
import { receive } from "@/modules/wallet";
import { Cents, err, ok, type Result } from "@/shared/kernel";
import type {
  ListEmpty,
  ListTooLong,
  NoPrice,
  NotBuying,
  PricesChanged,
  QuantityInvalid,
  WorthNothing,
} from "../domain/errors";
import { totalPrice } from "../domain/pricing";
import { payoutPerCopy } from "../domain/singles";
import type { ListReceipt } from "./buy-list";
import { quoteKey, type StoreDependencies } from "./ports";
import type { SingleInput } from "./singles";

export const MAX_SELL_LINES = 500;
export const MAX_SELL_QUANTITY = 999;

type SellListInput = Readonly<{
  lines: readonly SingleInput[];
  /** Minimum payout the player confirmed. If prices dropped below this, nothing is sold. */
  expectedTotal: Cents;
}>;

export type SellListError =
  | ListEmpty
  | ListTooLong
  | QuantityInvalid
  | NotBuying
  | NoPrice
  | WorthNothing
  | NotEnoughCopies
  | PricesChanged;

/**
 * Sells a batch of cards in a single atomic transaction: every line is quoted at today's buylist
 * rate, verified against `expectedTotal`, removed from the collection, and paid to the wallet.
 */
export function makeSellList(dependencies: StoreDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function sellList(
    actor: Actor,
    input: SellListInput,
  ): Promise<Result<ListReceipt, SellListError>> {
    if (input.lines.length === 0) return err({ kind: "ListEmpty" });
    if (input.lines.length > MAX_SELL_LINES) {
      return err({ kind: "ListTooLong", max: MAX_SELL_LINES });
    }
    for (const line of input.lines) {
      if (
        !Number.isInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > MAX_SELL_QUANTITY
      ) {
        return err({ kind: "QuantityInvalid", max: MAX_SELL_QUANTITY });
      }
    }

    return unitOfWork.run<ListReceipt, SellListError>(async (services) => {
      const rateBps = await services.storeSettings.buylistRate();
      if (rateBps === 0) return err({ kind: "NotBuying" });

      const priced: Array<{
        line: SingleInput;
        unitMarket: Cents;
        unitPrice: Cents;
        lineTotal: Cents;
        day: string;
      }> = [];

      const quotedByKey = await services.marketPrices.quoteMany(input.lines);
      for (const line of input.lines) {
        const quote = quotedByKey.get(quoteKey(line.printingId, line.finish));
        if (quote === undefined) return err({ kind: "NoPrice" });
        const unitPrice = payoutPerCopy(quote.price, rateBps);
        if (unitPrice === 0) return err({ kind: "WorthNothing" });
        priced.push({
          line,
          unitMarket: quote.price,
          unitPrice,
          lineTotal: totalPrice(unitPrice, line.quantity),
          day: quote.day,
        });
      }

      const total = Cents.sum(priced.map((entry) => entry.lineTotal));
      if (total < input.expectedTotal) return err({ kind: "PricesChanged", total });

      const now = clock.now();
      const transactionIds = await services.storeLedger.recordSingles(
        priced.map((entry) => ({
          userId: actor.userId,
          direction: "sell" as const,
          printingId: entry.line.printingId,
          finish: entry.line.finish,
          quantity: entry.line.quantity,
          unitMarket: entry.unitMarket,
          rateBps,
          unitPrice: entry.unitPrice,
          total: entry.lineTotal,
          priceDay: entry.day,
          at: now,
        })),
      );

      const ref = `store:${transactionIds[0]}`;
      // Take every card in one batch: if any line lacks enough copies, nothing is removed.
      const given = await giveUpCards(
        services,
        actor.userId,
        priced.map((entry) => ({
          printingId: entry.line.printingId,
          finish: entry.line.finish,
          quantity: entry.line.quantity,
        })),
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

      const cards = input.lines.reduce((sum, line) => sum + line.quantity, 0);
      return ok({ cards, total, transactionIds });
    });
  }

  return sellList;
}
