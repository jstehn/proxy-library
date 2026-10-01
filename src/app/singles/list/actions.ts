"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import {
  MAX_LIST_LINES,
  quoteShoppingList,
  type BuyListError,
  type ListQuote,
} from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";

// Buying a list of singles (design doc 15, section 3). The quote is read only; buying runs the
// store's all-or-nothing purchase, which prices everything again.

const QuoteInput = z.object({
  text: z.string().max(40_000),
  preference: z.enum(["cheapest", "newest"]),
  onlyMissing: z.boolean(),
  chosen: z.record(z.string().regex(/^\d+$/), z.string().max(64)),
});

/** What the pasted list would buy right now. */
export async function quoteListAction(
  input: z.input<typeof QuoteInput>,
): Promise<ListQuote | null> {
  const actor = await requireActor();
  const parsed = QuoteInput.safeParse(input);
  if (!parsed.success) return null;
  const { text, preference, onlyMissing, chosen } = parsed.data;
  return quoteShoppingList(getContainer().db, actor.userId, text, {
    preference,
    onlyMissing,
    chosen: Object.fromEntries(Object.entries(chosen).map(([line, id]) => [Number(line), id])),
  });
}

const BuyInput = z.object({
  lines: z
    .array(
      z.object({
        printingId: z.string().min(1).max(64),
        finish: z.enum(["nonfoil", "foil", "etched"]),
        quantity: z.number().int(),
      }),
    )
    .max(MAX_LIST_LINES),
  expectedTotal: z.number().int().min(0),
});

export type BuyListResult =
  { ok: true; message: string } | { ok: false; message: string; pricesChanged: boolean };

/** Buys every line, or nothing. */
export async function buyListAction(input: z.input<typeof BuyInput>): Promise<BuyListResult> {
  const actor = await requireActor();
  const parsed = BuyInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "That list wasn't understood.", pricesChanged: false };
  }
  const result = await getContainer().store.buyList(actor, {
    lines: parsed.data.lines.map((line) => ({
      ...line,
      printingId: PrintingId.of(line.printingId),
    })),
    expectedTotal: Cents.of(parsed.data.expectedTotal),
  });
  if (!result.ok) {
    return {
      ok: false,
      message: buyListMessage(result.error),
      pricesChanged: result.error.kind === "PricesChanged",
    };
  }
  revalidatePath("/", "layout"); // the balance in the header
  const { cards, total } = result.value;
  return {
    ok: true,
    message: `Bought ${cards} ${cards === 1 ? "card" : "cards"} for ${Cents.format(total)}. They're in your collection.`,
  };
}

function buyListMessage(error: BuyListError): string {
  switch (error.kind) {
    case "ListEmpty":
      return "There's nothing to buy in this list.";
    case "ListTooLong":
      return `At most ${error.max} lines at once.`;
    case "QuantityInvalid":
      return `Each line can buy 1 to ${error.max} copies.`;
    case "LineNotForSale":
      return `Line ${error.line + 1} can't be bought any more. Nothing was bought.`;
    case "PricesChanged":
      return `Prices changed since you looked: it's now ${Cents.format(error.total)}. Nothing was bought; check the new total and buy again.`;
    case "InsufficientFunds":
      return `That's ${Cents.format(error.required)}, and you have ${Cents.format(error.balance)}. Nothing was bought.`;
  }
}
