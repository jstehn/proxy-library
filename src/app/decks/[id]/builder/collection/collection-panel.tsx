"use client";
import { useRef, type ReactNode, type RefObject } from "react";
import type { BrowseCard } from "@/modules/decks";
import { mainType } from "@/modules/decks/client";
import { CollectionFilters } from "./collection-filters";
import { GridCard } from "./grid-card";
import { nextByPosition } from "./grid-keys";
import type { Browsing, CardSize } from "./use-browse";

// The collection side of the builder (design doc 14, section 2.1): filters above, your cards as
// pictures below. Choosing a card selects it; the selected card's sheet is passed in as `children`
// on wide screens, so it sticks to the bottom of this column.

/**
 * How big the cards in the grid are. Phones get a fixed number of columns instead, since a
 * minimum width that suits a desktop leaves one lonely column on a phone. (Written out in full so
 * Tailwind finds the classes.)
 */
const CARD_SIZES: Readonly<Record<CardSize, string>> = {
  small: "grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]",
  medium: "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]",
  large: "grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]",
};

type Props = {
  browsing: Browsing;
  /** On an element after the grid: when it comes into view, the next page loads. */
  endRef: RefObject<HTMLDivElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  showCommanderColors: boolean;
  /** Shown, on a phone, only on the Collection tab. */
  visibleOnPhone: boolean;
  selectedOracleId: string | null;
  /** Copies of a card in the deck, the maybeboard left out (design doc 32). */
  copiesInDeck: (oracleId: string) => number;
  onSelect: (card: BrowseCard) => void;
  /** Enter on the selected card adds it to the main deck. */
  onAddToMain: () => void;
  /** "+" and "-" change how many the Add buttons add. */
  onStepQuantity: (by: number) => void;
  children?: ReactNode;
};

export function CollectionPanel({ endRef, searchRef, children, ...props }: Props) {
  const { browsing, selectedOracleId } = props;
  const { cards, source, sort, isFirstPageLoading } = browsing;
  const gridRef = useRef<HTMLUListElement>(null);

  /** Arrow keys move the selection through the grid by position, so rows of any width work. */
  function onGridKey(event: React.KeyboardEvent) {
    const buttons = [...(gridRef.current?.querySelectorAll<HTMLElement>("[data-card]") ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index === -1) return;
    const card = cards[index];
    if (event.key === "Enter") {
      event.preventDefault();
      if (selectedOracleId === card.oracleId) props.onAddToMain();
      else props.onSelect(card);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      props.onStepQuantity(1);
      return;
    }
    if (event.key === "-") {
      props.onStepQuantity(-1);
      return;
    }
    const target = nextByPosition(buttons, index, event.key);
    if (target === null) return;
    event.preventDefault();
    buttons[target].focus();
    props.onSelect(cards[target]);
  }

  return (
    <section
      aria-label="Your collection"
      className={`min-w-0 flex-1 flex-col gap-3 ${props.visibleOnPhone ? "flex" : "hidden lg:flex"}`}
    >
      <CollectionFilters
        browsing={browsing}
        searchRef={searchRef}
        showCommanderColors={props.showCommanderColors}
      />
      <ul
        ref={gridRef}
        onKeyDown={onGridKey}
        aria-label={source === "mine" ? "Cards you own" : "Every card"}
        className={`grid ${CARD_SIZES[browsing.cardSize]} gap-3 transition-opacity ${isFirstPageLoading && cards.length > 0 ? "opacity-60" : ""}`}
      >
        {cards.map((card, index) => {
          const startsType =
            sort === "type" &&
            (index === 0 || mainType(cards[index - 1].typeLine) !== mainType(card.typeLine));
          return (
            <GridCard
              key={card.oracleId}
              card={card}
              heading={startsType ? mainType(card.typeLine) : null}
              inThisDeck={props.copiesInDeck(card.oracleId)}
              isSelected={selectedOracleId === card.oracleId}
              onSelect={() => props.onSelect(card)}
            />
          );
        })}
      </ul>
      {!isFirstPageLoading && cards.length === 0 && (
        <p className="text-muted text-sm">
          {source === "mine" ? "None of your cards match" : "No cards match"}. Try fewer filters, or
          &quot;Show cards that don&apos;t fit&quot;.
        </p>
      )}
      <div ref={endRef} className="h-1" />
      {browsing.loadingMore && <p className="text-muted text-center text-xs">Loading more…</p>}
      {children}
    </section>
  );
}
