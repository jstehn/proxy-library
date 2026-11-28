"use client";
// Context wrapper for any grid of CardTiles (design doc 73): holds one shared CardPreviewDialog
// so clicking or tapping any tile opens a carousel that steps through the entire grid.
import { createContext, useContext, useState, type ReactNode } from "react";
import type { PrintingCard } from "@/modules/catalog";
import { wrapIndex, type CardStepping } from "@/ui/mtg/card-art-logic";
import { CardPreviewDialog, type CardPreviewVariant } from "./card-preview";

export type CardPreviewItem = Readonly<{
  printing: PrintingCard;
  href?: string;
  variants?: readonly CardPreviewVariant[];
}>;

type CardPreviewGroupContextValue = Readonly<{
  openCard: (printingId: string) => void;
}>;

const CardPreviewGroupContext = createContext<CardPreviewGroupContextValue | null>(null);

export function useCardPreviewGroup(): CardPreviewGroupContextValue | null {
  return useContext(CardPreviewGroupContext);
}

export function CardPreviewGroup(props: {
  cards: readonly CardPreviewItem[];
  children: ReactNode;
}) {
  const { cards, children } = props;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const openCard = (printingId: string) => {
    const index = cards.findIndex((item) => item.printing.id === printingId);
    if (index !== -1) setActiveIndex(index);
  };

  const activeItem = activeIndex !== null ? (cards[activeIndex] ?? null) : null;
  const stepping: CardStepping | null =
    activeIndex !== null && cards.length > 1
      ? {
          position: activeIndex + 1,
          total: cards.length,
          onPrevious: () => setActiveIndex((current) => wrapIndex(current ?? 0, -1, cards.length)),
          onNext: () => setActiveIndex((current) => wrapIndex(current ?? 0, 1, cards.length)),
        }
      : null;

  return (
    <CardPreviewGroupContext.Provider value={{ openCard }}>
      {children}
      {activeItem !== null && (
        <CardPreviewDialog
          printing={activeItem.printing}
          href={activeItem.href}
          variants={activeItem.variants}
          open={activeItem !== null}
          onClose={() => setActiveIndex(null)}
          stepping={stepping}
        />
      )}
    </CardPreviewGroupContext.Provider>
  );
}
