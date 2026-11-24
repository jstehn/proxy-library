"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import {
  MAX_SELL_LINES,
  MAX_SELL_QUANTITY,
  describeSellListError,
  selectDuplicatesToSell,
  type DuplicateSellLine,
} from "@/modules/store";
import { readPage } from "@/server/page-instance";
import { Cents } from "@/shared/kernel";
import { FinishSchema } from "@/shared/mtg";
import { revalidateHeader } from "@/app/paths";

export type SellCartItem = DuplicateSellLine;

const FindDuplicatesInput = z.object({
  keep: z.number().int().min(1).max(4),
  protectInDecks: z.boolean(),
  keepFoils: z.boolean(),
});

type FindDuplicatesResult = Readonly<{
  items: SellCartItem[];
  skippedUnpriced: number;
  buylistRateBps: number;
}>;

/** Finds all sellable duplicate copies across the player's game collection. */
export async function findDuplicatesToSellAction(
  input: z.input<typeof FindDuplicatesInput>,
): Promise<FindDuplicatesResult> {
  const { actor, reads } = await readPage();
  const parsed = FindDuplicatesInput.safeParse(input);
  if (!parsed.success) {
    return { items: [], skippedUnpriced: 0, buylistRateBps: 0 };
  }
  const { keep, protectInDecks, keepFoils } = parsed.data;

  const [stacks, rateBps] = await Promise.all([
    reads.collection.duplicateStacks(actor, keep),
    reads.store.buylistRate(),
  ]);

  if (rateBps === 0 || stacks.length === 0) {
    return { items: [], skippedUnpriced: 0, buylistRateBps: rateBps };
  }

  const decksByPrinting = await reads.decks.decksUsing(
    actor,
    stacks.map((stack) => stack.printingId),
  );

  const selection = selectDuplicatesToSell(stacks, decksByPrinting, rateBps, {
    keep,
    protectInDecks,
    keepFoils,
    maxLines: MAX_SELL_LINES,
    maxQuantity: MAX_SELL_QUANTITY,
  });

  return {
    ...selection,
    buylistRateBps: rateBps,
  };
}

const SellCartInput = z.object({
  lines: z
    .array(
      z.object({
        printingId: z.string().min(1).max(64),
        finish: FinishSchema,
        quantity: z.number().int().min(1).max(MAX_SELL_QUANTITY),
      }),
    )
    .max(MAX_SELL_LINES),
  expectedTotal: z.number().int().min(0),
});

type SellCartResult =
  { ok: true; message: string } | { ok: false; message: string; pricesChanged: boolean };

/** Sells every staged line in one atomic transaction. */
export async function sellCartAction(
  input: z.input<typeof SellCartInput>,
): Promise<SellCartResult> {
  const { actor, capabilities } = await readPage();
  const parsed = SellCartInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "That sell cart wasn't understood.", pricesChanged: false };
  }

  const result = await capabilities.store.sellList(actor, {
    lines: parsed.data.lines.map((line) => ({
      ...line,
      printingId: PrintingId.of(line.printingId),
    })),
    expectedTotal: Cents.of(parsed.data.expectedTotal),
  });

  if (!result.ok) {
    return {
      ok: false,
      message: describeSellListError(result.error),
      pricesChanged: result.error.kind === "PricesChanged",
    };
  }

  revalidateHeader();
  revalidatePath("/collection");
  const { cards, total } = result.value;
  return {
    ok: true,
    message: `Sold ${cards} ${cards === 1 ? "card" : "cards"} for ${Cents.format(total)}.`,
  };
}
