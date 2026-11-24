"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SealedProductId, type PrintingCard } from "@/modules/catalog";
import { describeBuySealedError } from "@/modules/store";
import { formAction } from "@/server/form-action-instance";
import { readPage } from "@/server/page-instance";
import type { Finish } from "@/shared/mtg";
import { revalidateHeader } from "@/app/paths";
import { finishOpening } from "@/app/inventory/finish-opening";

const BuyForm = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number(),
});

export const buySealedAction = formAction(
  BuyForm,
  async ({ actor, capabilities }, form) => {
    const result = await capabilities.store.buySealed(actor, {
      productId: SealedProductId.of(form.productId),
      quantity: form.quantity,
    });
    if (result.ok) revalidateHeader(); // the balance in the header changes
    return result;
  },
  {
    invalidInput: "Choose how many to buy.",
    describeError: describeBuySealedError,
    successMessage: ({ items }) =>
      `Bought ${items.length === 1 ? "it" : `${items.length}`}. ${items.length === 1 ? "It's" : "They're"} waiting in your inventory.`,
  },
);

export const buyAndOpenAction = formAction(
  BuyForm,
  async ({ actor, capabilities }, form) => {
    const bought = await capabilities.store.buySealed(actor, {
      productId: SealedProductId.of(form.productId),
      quantity: form.quantity,
    });
    if (!bought.ok) return bought;

    revalidateHeader();
    const itemIds = bought.value.items.map((item) => item.id);
    const opened = await capabilities.inventory.openAll(actor, itemIds);
    if (!opened.ok) {
      return bought;
    }

    redirect(await finishOpening(actor, capabilities, opened.value));
  },
  {
    invalidInput: "Choose how many to buy.",
    describeError: describeBuySealedError,
    successMessage: () => "Bought! Open it from your inventory.",
  },
);

export type HydratedProductContents = Readonly<{
  productId: string;
  productName: string;
  packs: ReadonlyArray<{
    setCode: string;
    boosterType: string;
    count: number;
    cardsPerPack: number | null;
    rarityAverages: ReadonlyArray<{ label: string; average: number }>;
    chaseCards: ReadonlyArray<{ printing: PrintingCard; unitPriceCents: number }>;
  }>;
  decks: ReadonlyArray<{
    setCode: string;
    name: string;
    type: string;
    totalCards: number;
    marketValueCents: number;
    cards: ReadonlyArray<{
      printing: PrintingCard;
      count: number;
      finish: Finish;
      board: "main" | "side" | "commander";
      unitPriceCents: number;
    }>;
  }>;
  cards: ReadonlyArray<{
    printing: PrintingCard;
    finish: Finish;
    count: number;
    unitPriceCents: number;
  }>;
  extras: readonly string[];
  variableNotes: readonly string[];
  wpnDescription: string | null;
  wpnContents: ReadonlyArray<{ depth: number; text: string }>;
}>;

/** Loads structured contents (deck lists, booster odds + chase cards, promos, WPN copy). */
export async function loadProductContentsAction(
  productId: string,
): Promise<HydratedProductContents | null> {
  if (typeof productId !== "string" || productId.trim() === "") return null;
  const { capabilities, reads } = await readPage();
  const raw = await reads.store.productContents(productId);
  if (raw === null) return null;

  const allIds: string[] = [
    ...raw.cards.map((c) => c.printingId),
    ...raw.decks.flatMap((d) => d.cards.map((c) => c.printingId)),
    ...raw.packs.flatMap((p) => p.chasePrintingIds),
  ];
  const printings = await capabilities.printingDetails(allIds);

  const decks = raw.decks.map((deck) => {
    let totalCards = 0;
    let marketValueCents = 0;
    const cards = deck.cards.flatMap((card) => {
      const printing = printings.get(card.printingId);
      if (!printing) return [];
      const unitPriceCents = Number(printing.prices[card.finish] ?? 0);
      totalCards += card.count;
      marketValueCents += unitPriceCents * card.count;
      return [
        { printing, count: card.count, finish: card.finish, board: card.board, unitPriceCents },
      ];
    });
    return {
      setCode: deck.setCode,
      name: deck.name,
      type: deck.type,
      totalCards,
      marketValueCents,
      cards,
    };
  });

  const packs = raw.packs.map((pack) => ({
    setCode: pack.setCode,
    boosterType: pack.boosterType,
    count: pack.count,
    cardsPerPack: pack.cardsPerPack,
    rarityAverages: pack.rarityAverages,
    chaseCards: pack.chasePrintingIds.flatMap((id) => {
      const printing = printings.get(id);
      if (!printing) return [];
      const unitPriceCents = Number(printing.prices.nonfoil ?? printing.prices.foil ?? 0);
      return [{ printing, unitPriceCents }];
    }),
  }));

  const cards = raw.cards.flatMap((card) => {
    const printing = printings.get(card.printingId);
    if (!printing) return [];
    const unitPriceCents = Number(printing.prices[card.finish] ?? 0);
    return [{ printing, finish: card.finish, count: card.count, unitPriceCents }];
  });

  return {
    productId: raw.productId,
    productName: raw.productName,
    packs,
    decks,
    cards,
    extras: raw.extras,
    variableNotes: raw.variableNotes,
    wpnDescription: raw.wpnDescription,
    wpnContents: raw.wpnContents,
  };
}
