"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { PrintingCard } from "@/modules/catalog";
import { EnlargedCard } from "./card-preview";

// One card in a grid (a set's cards, a pack's pulls). Hovering (or focusing, or tapping) it opens a larger version with
// its printed text laid over the image, because the small grid image is too small to read.

const RARITY_COLORS: Record<string, string> = {
  common: "text-zinc-500",
  uncommon: "text-slate-500",
  rare: "text-amber-600",
  mythic: "text-orange-600",
};

type CardTileProps = {
  printing: PrintingCard;
  priceLine: string;
  /** Pulled as a foil (or etched): shows a rainbow sheen over the image. */
  isFoil?: boolean;
  /** Where the card's name links to (its card page), if anywhere. */
  href?: string;
  /** An extra line under the price, e.g. which decks use this card. */
  note?: string;
};

export function CardTile(props: CardTileProps) {
  const { printing } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [align, setAlign] = useState<"center" | "left" | "right">("center");
  const tileRef = useRef<HTMLLIElement>(null);

  // The enlarged card is wider than the tile; near the screen's edges, line it up with the
  // tile's edge instead of its center so it isn't cut off.
  function open() {
    const tile = tileRef.current?.getBoundingClientRect();
    if (tile !== undefined) {
      const overhang = tile.width * 0.4;
      if (tile.left - overhang < 8) setAlign("left");
      else if (tile.right + overhang > window.innerWidth - 8) setAlign("right");
      else setAlign("center");
    }
    setIsOpen(true);
  }

  return (
    <li
      ref={tileRef}
      className="relative flex flex-col gap-1 text-sm"
      onMouseEnter={open}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        onFocus={open}
        onBlur={() => setIsOpen(false)}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        aria-expanded={isOpen}
        aria-label={`${printing.name}: show card text`}
        className="relative block w-full rounded-[4.5%] focus:outline-2 focus:outline-offset-2"
      >
        {printing.hasImage ? (
          // Plain <img>: pre-sized images from our own cache, lazily loaded. `srcSet` offers both
          // sizes and `sizes` says how wide a tile is; the browser picks the sharper "normal"
          // image whenever the small one (146 px) would be blurry, e.g. on wide or high-density
          // screens. (The small one alone was too soft to read.)
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${printing.id}/small/front`}
            srcSet={`/api/images/${printing.id}/small/front 146w, /api/images/${printing.id}/normal/front 488w`}
            sizes="(min-width: 1024px) 190px, (min-width: 640px) 30vw, 50vw"
            alt={printing.name}
            loading="lazy"
            width={146}
            height={204}
            className="aspect-[146/204] w-full rounded-[4.5%] bg-zinc-100 dark:bg-zinc-800"
          />
        ) : (
          <div className="flex aspect-[146/204] w-full items-center justify-center rounded-md bg-zinc-100 p-2 text-center text-xs text-zinc-500 dark:bg-zinc-800">
            {printing.name}
          </div>
        )}
        {props.isFoil && <FoilSheen />}
      </button>
      {props.href ? (
        <Link href={props.href} className="leading-tight font-medium hover:underline">
          {printing.name}
        </Link>
      ) : (
        <span className="leading-tight font-medium">{printing.name}</span>
      )}
      <span className={`text-xs ${RARITY_COLORS[printing.rarity] ?? "text-zinc-500"}`}>
        #{printing.collectorNumber} · {printing.rarity}
        {printing.variantLabel && ` · ${printing.variantLabel}`}
      </span>
      <span className="text-xs text-zinc-600 tabular-nums dark:text-zinc-400">
        {props.priceLine}
      </span>
      {props.note && <span className="text-xs text-sky-700 dark:text-sky-400">{props.note}</span>}

      {isOpen && <EnlargedCard printing={printing} align={align} />}
    </li>
  );
}

/** A still rainbow sheen for foils. (The animated one comes with the opening effects, Phase 8.) */
function FoilSheen() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[4.5%] bg-gradient-to-br from-fuchsia-400/35 via-transparent to-cyan-300/40 ring-2 ring-sky-400 ring-offset-1"
    />
  );
}
