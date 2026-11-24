import type { PrintingCard } from "@/modules/catalog";
import { assertNever } from "@/shared/kernel";
import type { Finish } from "@/shared/mtg";

export type OpenedSort = "value" | "rarity" | "duplicates" | "color" | "order";

type OpenedCardEntry = Readonly<{
  printingId: string;
  finish: Finish;
  quantity: number;
}>;

export type SerializedOpening = Readonly<{
  itemId: number;
  name: string;
  contentKind: string;
  theme: string | null;
  children: ReadonlyArray<{ itemId: number; name: string; status: string }>;
  extras: readonly string[];
  cards: readonly OpenedCardEntry[];
}>;

export type CombinedOpenedCard = Readonly<{
  key: string;
  printing: PrintingCard;
  finish: Finish;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  /** Total copies of this printing+finish the player owns in their collection now (after opening). */
  ownedTotal: number | null;
  packOrder: number;
}>;

const RARITY_RANK: Record<string, number> = {
  mythic: 5,
  rare: 4,
  special: 3,
  bonus: 3,
  uncommon: 2,
  common: 1,
};

const COLOR_RANK: Record<string, number> = {
  W: 1,
  U: 2,
  B: 3,
  R: 4,
  G: 5,
};

const BIG_HIT_CENTS = 500;

function colorSortKey(printing: PrintingCard): number {
  const isLand = printing.faces[0]?.typeLine.toLowerCase().includes("land") ?? false;
  if (isLand) return 8;
  if (printing.colors.length === 0) return 7;
  if (printing.colors.length > 1) return 6;
  return COLOR_RANK[printing.colors[0]] ?? 7;
}

export function cardKey(printingId: string, finish: Finish): string {
  return `${printingId}/${finish}`;
}

/**
 * Merges identical (printingId, finish) pulls across all openings so duplicates stack cleanly.
 */
export function combineOpenedCards(
  openings: readonly SerializedOpening[],
  cardsById: Readonly<Record<string, PrintingCard>>,
  ownedByKey: Readonly<Record<string, number>> = {},
): CombinedOpenedCard[] {
  const byKey = new Map<
    string,
    {
      printing: PrintingCard;
      finish: Finish;
      quantity: number;
      unitPriceCents: number;
      ownedTotal: number | null;
      packOrder: number;
    }
  >();

  let position = 0;
  for (const opening of openings) {
    for (const card of opening.cards) {
      const printing = cardsById[card.printingId];
      if (printing === undefined) continue;
      const key = cardKey(card.printingId, card.finish);
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += card.quantity;
      } else {
        const unitPriceCents = Number(printing.prices[card.finish] ?? 0);
        byKey.set(key, {
          printing,
          finish: card.finish,
          quantity: card.quantity,
          unitPriceCents,
          ownedTotal: key in ownedByKey ? ownedByKey[key] : null,
          packOrder: position,
        });
      }
      position += 1;
    }
  }

  return [...byKey.entries()].map(([key, item]) => ({
    key,
    printing: item.printing,
    finish: item.finish,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    totalPriceCents: item.unitPriceCents * item.quantity,
    ownedTotal: item.ownedTotal,
    packOrder: item.packOrder,
  }));
}

export function sortOpenedCards(
  items: readonly CombinedOpenedCard[],
  sort: OpenedSort,
): CombinedOpenedCard[] {
  const copy = [...items];
  copy.sort((a, b) => {
    switch (sort) {
      case "value":
        return (
          b.unitPriceCents - a.unitPriceCents ||
          (RARITY_RANK[b.printing.rarity] ?? 0) - (RARITY_RANK[a.printing.rarity] ?? 0) ||
          a.printing.name.localeCompare(b.printing.name)
        );
      case "rarity":
        return (
          (RARITY_RANK[b.printing.rarity] ?? 0) - (RARITY_RANK[a.printing.rarity] ?? 0) ||
          b.unitPriceCents - a.unitPriceCents ||
          a.printing.name.localeCompare(b.printing.name)
        );
      case "duplicates":
        return (
          b.quantity - a.quantity ||
          b.unitPriceCents - a.unitPriceCents ||
          a.printing.name.localeCompare(b.printing.name)
        );
      case "color":
        return (
          colorSortKey(a.printing) - colorSortKey(b.printing) ||
          b.unitPriceCents - a.unitPriceCents ||
          a.printing.name.localeCompare(b.printing.name)
        );
      case "order":
        return a.packOrder - b.packOrder;
      default:
        return assertNever(sort);
    }
  });
  return copy;
}

type PullSummary = Readonly<{
  totalCopies: number;
  uniqueStacks: number;
  duplicateCopies: number;
  totalCents: number;
  highlights: readonly CombinedOpenedCard[];
}>;

export function summarizePulls(combined: readonly CombinedOpenedCard[]): PullSummary {
  let totalCopies = 0;
  let duplicateCopies = 0;
  let totalCents = 0;
  for (const item of combined) {
    totalCopies += item.quantity;
    if (item.quantity > 1) duplicateCopies += item.quantity - 1;
    totalCents += item.totalPriceCents;
  }
  const highlights = sortOpenedCards(
    combined.filter(
      (item) => item.printing.rarity === "mythic" || item.unitPriceCents >= BIG_HIT_CENTS,
    ),
    "value",
  ).slice(0, 8);

  return {
    totalCopies,
    uniqueStacks: combined.length,
    duplicateCopies,
    totalCents,
    highlights,
  };
}
