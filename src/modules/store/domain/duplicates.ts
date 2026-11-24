import { Cents } from "@/shared/kernel";
import type { Finish } from "@/shared/mtg";
import { payoutPerCopy } from "./singles";

// Pure rules for staging duplicate cards into the sell cart (functional core).

export type DuplicateCandidateStack = Readonly<{
  printingId: string;
  finish: Finish;
  quantity: number;
  name: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  marketCents: number | null;
}>;

export type DeckUsage = Readonly<{
  name: string;
  quantity: number;
}>;

export type DuplicateSelectionOptions = Readonly<{
  keep: number;
  protectInDecks: boolean;
  keepFoils: boolean;
  maxLines: number;
  maxQuantity: number;
}>;

export type DuplicateSellLine = Readonly<{
  printingId: string;
  finish: Finish;
  name: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  owned: number;
  quantity: number;
  unitPayoutCents: number;
  deckNote?: string;
}>;

export type DuplicateSelection = Readonly<{
  items: DuplicateSellLine[];
  skippedUnpriced: number;
}>;

/**
 * Decides which extra copies from a player's stacks can be staged for sale, respecting `keep`,
 * deck protection, foil preservation, and the store's current buylist rate.
 */
export function selectDuplicatesToSell(
  stacks: readonly DuplicateCandidateStack[],
  decksByPrinting: ReadonlyMap<string, readonly DeckUsage[]>,
  buylistRateBps: number,
  options: DuplicateSelectionOptions,
): DuplicateSelection {
  if (buylistRateBps <= 0 || stacks.length === 0) {
    return { items: [], skippedUnpriced: 0 };
  }

  const items: DuplicateSellLine[] = [];
  let skippedUnpriced = 0;

  for (const stack of stacks) {
    if (options.keepFoils && stack.finish !== "nonfoil") continue;

    const decks = decksByPrinting.get(stack.printingId) ?? [];
    const copiesInDecks = decks.reduce((sum, deck) => sum + deck.quantity, 0);
    const reserved = options.protectInDecks ? Math.max(options.keep, copiesInDecks) : options.keep;
    const sellQuantity = Math.min(stack.quantity - reserved, options.maxQuantity);
    if (sellQuantity <= 0) continue;

    if (stack.marketCents === null) {
      skippedUnpriced += 1;
      continue;
    }
    const unitPayoutCents = Number(payoutPerCopy(Cents.of(stack.marketCents), buylistRateBps));
    if (unitPayoutCents <= 0) {
      skippedUnpriced += 1;
      continue;
    }

    const deckNote =
      decks.length > 0
        ? `In: ${decks.map((deck) => `${deck.name} (${deck.quantity})`).join(", ")}`
        : undefined;

    items.push({
      printingId: stack.printingId,
      finish: stack.finish,
      name: stack.name,
      setCode: stack.setCode,
      collectorNumber: stack.collectorNumber,
      rarity: stack.rarity,
      owned: stack.quantity,
      quantity: sellQuantity,
      unitPayoutCents,
      deckNote,
    });
  }

  return {
    items: items.slice(0, options.maxLines),
    skippedUnpriced,
  };
}
