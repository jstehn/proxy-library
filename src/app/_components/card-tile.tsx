"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { PrintingCard } from "@/modules/catalog";
import { CardPreviewDialog, EnlargedCard } from "./card-preview";
import { CardImage } from "@/ui/mtg/card-image";
import { rarityTextClass } from "@/ui/mtg/rarity";

const FOIL_SHEEN =
  "pointer-events-none absolute inset-0 rounded-[4.5%] bg-gradient-to-br from-fuchsia-400/35 via-transparent to-cyan-300/40 ring-2 ring-sky-400 ring-offset-1";
const NO_IMAGE_BOX =
  "bg-surface-raised text-muted flex aspect-[146/204] w-full items-center justify-center rounded-md p-2 text-center text-xs";

// One card in a grid (a set's cards, a pack's pulls). Hovering (or focusing, or tapping) it opens a larger version with
// its printed text laid over the image, because the small grid image is too small to read.

type CardTileProps = {
  printing: PrintingCard;
  priceLine: string;
  /** Pulled as a foil (or etched): shows a rainbow sheen over the image. */
  isFoil?: boolean;
  /** Where the card's name links to (its card page), if anywhere. */
  href?: string;
  /** An extra line under the price, e.g. which decks use this card. */
  note?: string;
  /** Optional corner pill rendered over the top-right of the card image (e.g. duplicate count). */
  badge?: React.ReactNode;
  /** Optional interactive footer below the tile details (e.g. quick sell controls). */
  footer?: React.ReactNode;
};

export function CardTile(props: CardTileProps) {
  const { printing } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [align, setAlign] = useState<"center" | "left" | "right">("center");
  const tileRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function isTouchOrNarrow() {
    return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
  }

  // The enlarged card is wider than the tile; near the screen's edges, line it up with the
  // tile's edge instead of its center so it isn't cut off.
  function open() {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const tile = tileRef.current?.getBoundingClientRect();
    if (tile !== undefined) {
      const overhang = tile.width * 0.4;
      if (tile.left - overhang < 8) setAlign("left");
      else if (tile.right + overhang > window.innerWidth - 8) setAlign("right");
      else setAlign("center");
    }
    setIsOpen(true);
  }

  function handleFocus() {
    if (buttonRef.current?.matches(":focus-visible")) open();
  }

  function handleActivate() {
    if (isTouchOrNarrow()) {
      setIsOpen(false);
      setIsDialogOpen(true);
    } else if (isOpen) {
      setIsOpen(false);
    } else {
      open();
    }
  }

  return (
    <li
      ref={tileRef}
      className="relative flex flex-col gap-1 text-sm"
      onMouseEnter={open}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        onFocus={handleFocus}
        onBlur={() => setIsOpen(false)}
        onClick={handleActivate}
        aria-expanded={isOpen || isDialogOpen}
        aria-label={`${printing.name}: show card text`}
        className="relative block w-full rounded-[4.5%]"
      >
        {printing.hasImage ? (
          // Pre-sized images from our own cache. `srcSet` offers both
          // sizes and `sizes` says how wide a tile is; the browser picks the sharper "normal"
          // image whenever the small one (146 px) would be blurry, e.g. on wide or high-density
          // screens. (The small one alone was too soft to read.)
          <CardImage
            src={`/api/images/${printing.id}/small/front`}
            srcSet={`/api/images/${printing.id}/small/front 146w, /api/images/${printing.id}/normal/front 488w`}
            sizes="(min-width: 1024px) 190px, (min-width: 640px) 30vw, 50vw"
            alt={printing.name}
            loading="lazy"
            width={146}
            height={204}
            className="bg-surface-raised aspect-[146/204] w-full rounded-[4.5%]"
          />
        ) : (
          <div className={NO_IMAGE_BOX}>{printing.name}</div>
        )}
        {props.isFoil && <FoilSheen />}
        {props.badge && (
          <span className="pointer-events-none absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
            {props.badge}
          </span>
        )}
      </button>
      {props.href ? (
        <Link href={props.href} className="leading-tight font-medium hover:underline">
          {printing.name}
        </Link>
      ) : (
        <span className="leading-tight font-medium">{printing.name}</span>
      )}
      <span className={`text-xs ${rarityTextClass(printing.rarity)}`}>
        #{printing.collectorNumber} · {printing.rarity}
        {printing.variantLabel && ` · ${printing.variantLabel}`}
      </span>
      <span className="text-muted text-xs tabular-nums">{props.priceLine}</span>
      {props.note && <span className="text-xs text-sky-700 dark:text-sky-400">{props.note}</span>}
      {props.footer && <div className="mt-0.5">{props.footer}</div>}

      {isOpen && <EnlargedCard printing={printing} align={align} />}
      {isDialogOpen && (
        <CardPreviewDialog
          printing={printing}
          open={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
        />
      )}
    </li>
  );
}

/** A still rainbow sheen for foils. (The animated one comes with the opening effects, Phase 8.) */
function FoilSheen() {
  return <span aria-hidden className={FOIL_SHEEN} />;
}
