"use client";
import type { BrowseCard } from "@/modules/decks";
import { Cents } from "@/shared/kernel";
import { ManaText } from "@/ui/mana";
import { ownedWords } from "../derive";
import { CardImage } from "@/ui/card-image";

// One card in the collection grid: its picture, its name and how many you own.

export function GridCard(props: {
  card: BrowseCard;
  heading: string | null;
  inThisDeck: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { card } = props;
  return (
    <>
      {props.heading !== null && (
        <li className="text-muted col-span-full pt-2 text-xs font-medium tracking-wide uppercase">
          {props.heading}
        </li>
      )}
      <li>
        <button
          type="button"
          data-card
          onClick={props.onSelect}
          aria-pressed={props.isSelected}
          aria-label={`${card.name}, ${card.owned === 0 ? "not owned" : `you own ${card.owned}`}${props.inThisDeck > 0 ? `, ${props.inThisDeck} in this deck` : ""}`}
          className="group block w-full text-left"
        >
          <span
            className={`relative block rounded-[5%] transition ${props.isSelected ? "ring-4 ring-sky-500" : "group-hover:scale-[1.03]"} ${card.misfit ? "opacity-45" : ""}`}
          >
            <CardImage
              src={`/api/images/${card.printingId}/normal/front`}
              decorative
              loading="lazy"
              width={488}
              height={680}
              className="bg-surface-raised aspect-[488/680] w-full rounded-[4.5%]"
            />
            {props.inThisDeck > 0 && (
              <span className="absolute top-1 right-1 rounded bg-green-700 px-1.5 text-[11px] font-semibold text-white">
                {props.inThisDeck} in deck
              </span>
            )}
            {card.misfit && (
              <span className="absolute top-1 left-1 rounded bg-amber-600 px-1.5 text-[11px] font-medium text-white">
                {card.misfit === "color" ? "off-color" : "not legal"}
              </span>
            )}
          </span>
          {/* The name, always readable (the art's own text is small at this size). */}
          <span className="mt-1 flex items-baseline gap-1 text-sm leading-tight">
            <span className="min-w-0 flex-1 truncate font-medium" title={card.name}>
              {card.name}
            </span>
            {card.manaCost && (
              <span className="shrink-0 text-xs">
                <ManaText text={card.manaCost} />
              </span>
            )}
          </span>
          <span className="text-muted block text-xs">
            {card.owned === 0 ? (
              <>
                <span className="text-warning-text font-medium">Not owned</span>
                {card.priceCents !== null && ` · ${Cents.format(Cents.of(card.priceCents))}`}
              </>
            ) : (
              `own ${ownedWords(card.owned, card.ownedReal)}`
            )}
            {card.otherDecks > 0 &&
              `${card.owned > 0 ? ` · ${card.free} free` : ""} · in ${card.otherDecks} other ${card.otherDecks === 1 ? "deck" : "decks"}`}
          </span>
        </button>
      </li>
    </>
  );
}
