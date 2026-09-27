"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { CardFace, PrintingCard } from "@/modules/catalog";
import { ManaText } from "@/ui/mana";

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
          // Plain <img>: pre-sized images from our own cache, lazily loaded.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${printing.id}/small/front`}
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

const ALIGN_CLASSES = {
  center: "left-1/2 -translate-x-1/2",
  left: "left-0",
  right: "right-0",
};

function EnlargedCard(props: { printing: PrintingCard; align: "center" | "left" | "right" }) {
  const { printing } = props;
  return (
    <div
      // pointer-events-none: moving the mouse over the enlarged card counts as staying on the tile.
      className={`pointer-events-none absolute -top-3 z-30 w-[160%] max-w-80 min-w-60 ${ALIGN_CLASSES[props.align]}`}
    >
      <div className="relative overflow-hidden rounded-[4.5%] shadow-2xl ring-1 ring-black/20">
        {printing.hasImage ? (
          // The sharper "normal" image, only loaded for the card being looked at.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${printing.id}/normal/front`}
            alt=""
            width={488}
            height={680}
            className="aspect-[488/680] w-full bg-zinc-200 dark:bg-zinc-800"
          />
        ) : (
          <div className="aspect-[488/680] w-full bg-zinc-200 dark:bg-zinc-800" />
        )}

        {/* The overlay: the card's printed text, readable at any size. */}
        <div className="absolute inset-x-0 bottom-0 flex max-h-full flex-col gap-2 overflow-hidden bg-gradient-to-t from-black/95 via-black/85 to-black/60 p-3 text-xs text-white">
          {printing.faces.map((face, index) => (
            <FaceText key={index} face={face} isBackFace={index > 0} />
          ))}
          {printing.faces.length === 0 && <p className="font-semibold">{printing.name}</p>}
          <p className="text-[10px] text-white/60">
            {printing.variantLabel && `${printing.variantLabel} · `}
            {printing.artist && `Illustrated by ${printing.artist}`}
          </p>
        </div>
      </div>
    </div>
  );
}

function FaceText(props: { face: CardFace; isBackFace: boolean }) {
  const { face } = props;
  const stats =
    face.power !== null && face.toughness !== null
      ? `${face.power}/${face.toughness}`
      : face.loyalty !== null
        ? `Loyalty ${face.loyalty}`
        : face.defense !== null
          ? `Defense ${face.defense}`
          : null;

  return (
    <div
      className={`flex flex-col gap-1 ${props.isBackFace ? "border-t border-white/20 pt-2" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{face.name}</span>
        {face.manaCost && (
          <span className="shrink-0">
            <ManaText text={face.manaCost} />
          </span>
        )}
      </div>
      <p className="text-white/80 italic">{face.typeLine}</p>
      {face.text
        .split("\n")
        .filter((paragraph) => paragraph.trim() !== "")
        .map((paragraph, index) => (
          <p key={index} className="leading-snug">
            <ManaText text={paragraph} />
          </p>
        ))}
      {stats && (
        <p className="self-end rounded bg-white/15 px-2 py-0.5 font-semibold tabular-nums">
          {stats}
        </p>
      )}
    </div>
  );
}
