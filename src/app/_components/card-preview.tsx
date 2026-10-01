"use client";
import { useRef, useState } from "react";
import type { CardFace, PrintingCard } from "@/modules/catalog";
import { ManaText } from "@/ui/mana";

// A card, larger, with its printed text laid over the image: used wherever a card is too small
// (or only a name) to read. Card grids open it on hover; a Commander deck in the store shows its
// commander this way (design doc 14).

const ALIGN_CLASSES = {
  center: "left-1/2 -translate-x-1/2",
  left: "left-0",
  right: "right-0",
};

export function EnlargedCard(props: {
  printing: PrintingCard;
  align: "center" | "left" | "right";
}) {
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

/**
 * A card's full image that opens the enlarged, readable version on hover, focus or tap. Used
 * for a Commander deck's commander in the store, so it's clear who leads the deck.
 */
export function CardWithPreview(props: { printing: PrintingCard; caption?: string }) {
  const { printing } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [align, setAlign] = useState<"center" | "left" | "right">("center");
  const frameRef = useRef<HTMLDivElement>(null);

  function open() {
    const frame = frameRef.current?.getBoundingClientRect();
    if (frame !== undefined) {
      const overhang = frame.width * 0.4;
      if (frame.left - overhang < 8) setAlign("left");
      else if (frame.right + overhang > window.innerWidth - 8) setAlign("right");
      else setAlign("center");
    }
    setIsOpen(true);
  }

  return (
    <div
      ref={frameRef}
      className="relative"
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
        className="block w-full rounded-[4.5%] focus:outline-2 focus:outline-offset-2"
      >
        {printing.hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${printing.id}/normal/front`}
            alt={printing.name}
            loading="lazy"
            width={488}
            height={680}
            className="aspect-[488/680] w-full rounded-[4.5%] bg-zinc-100 shadow-md dark:bg-zinc-800"
          />
        ) : (
          <div className="flex aspect-[488/680] w-full items-center justify-center rounded-[4.5%] bg-zinc-100 p-2 text-center text-xs dark:bg-zinc-800">
            {printing.name}
          </div>
        )}
      </button>
      {props.caption && (
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{props.caption}</p>
      )}
      {isOpen && <EnlargedCard printing={printing} align={align} />}
    </div>
  );
}
