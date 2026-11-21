"use client";
import { useEffect, useRef, useState } from "react";
import type { CardFace, PrintingCard } from "@/modules/catalog";
import { Button } from "@/ui/button";
import { CardView } from "@/ui/card-view";
import { ManaText } from "@/ui/mana";
import { CardImage } from "@/ui/card-image";

const DIALOG_BOX =
  "border-border-subtle bg-background text-foreground m-auto max-h-[85dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border p-4 shadow-2xl backdrop:bg-black/70";
const NO_IMAGE_BOX =
  "bg-surface-raised flex aspect-[488/680] w-full items-center justify-center rounded-[4.5%] p-2 text-center text-xs";
const TEXT_OVERLAY =
  "absolute inset-x-0 bottom-0 flex max-h-full flex-col gap-2 overflow-hidden bg-gradient-to-t from-black/95 via-black/85 to-black/60 p-3 text-xs text-white";

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
          <CardImage
            src={`/api/images/${printing.id}/normal/front`}
            decorative
            width={488}
            height={680}
            className="bg-surface-raised aspect-[488/680] w-full"
          />
        ) : (
          <div className="bg-surface-raised aspect-[488/680] w-full" />
        )}

        {/* The overlay: the card's printed text, readable at any size. */}
        <div className={TEXT_OVERLAY}>
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

/** One face's printed text: name and cost, type line, rules text, stats. */
export function FaceText(props: { face: CardFace; isBackFace: boolean }) {
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

/** Touch-friendly native modal preview with scrollable card text and an explicit close button. */
export function CardPreviewDialog(props: {
  printing: PrintingCard;
  open: boolean;
  onClose: () => void;
}) {
  const { printing, open, onClose } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      aria-label={printing.name}
      className={DIALOG_BOX}
    >
      <CardView
        printingId={printing.id}
        name={printing.name}
        hasImage={printing.hasImage}
        faces={printing.faces}
        credit={[printing.variantLabel, printing.artist && `Illustrated by ${printing.artist}`]
          .filter(Boolean)
          .join(" · ")}
        layout="stacked"
        heading={
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{printing.name}</span>
            <Button
              type="button"
              onClick={onClose}
              aria-label="Close card preview"
              variant="secondary"
              className="min-h-11 min-w-11"
            >
              Close
            </Button>
          </div>
        }
      />
    </dialog>
  );
}

/**
 * A card's full image that opens the enlarged, readable version on hover, focus or tap. Used
 * for a Commander deck's commander in the store, so it's clear who leads the deck.
 */
export function CardWithPreview(props: { printing: PrintingCard; caption?: string }) {
  const { printing } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [align, setAlign] = useState<"center" | "left" | "right">("center");
  const frameRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function isTouchOrNarrow() {
    return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
  }

  function open() {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const frame = frameRef.current?.getBoundingClientRect();
    if (frame !== undefined) {
      const overhang = frame.width * 0.4;
      if (frame.left - overhang < 8) setAlign("left");
      else if (frame.right + overhang > window.innerWidth - 8) setAlign("right");
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
    <div
      ref={frameRef}
      className="relative"
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
        className="block w-full rounded-[4.5%]"
      >
        {printing.hasImage ? (
          <CardImage
            src={`/api/images/${printing.id}/normal/front`}
            alt={printing.name}
            loading="lazy"
            width={488}
            height={680}
            className="bg-surface-raised aspect-[488/680] w-full rounded-[4.5%] shadow-md"
          />
        ) : (
          <div className={NO_IMAGE_BOX}>{printing.name}</div>
        )}
      </button>
      {props.caption && <p className="text-muted mt-1 text-xs">{props.caption}</p>}
      {isOpen && <EnlargedCard printing={printing} align={align} />}
      {isDialogOpen && (
        <CardPreviewDialog
          printing={printing}
          open={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
        />
      )}
    </div>
  );
}

/** Where a name's floating preview goes: beside the name, kept inside the window. */
type PreviewSpot = Readonly<{ left: number; top: number }>;

const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = Math.round((PREVIEW_WIDTH * 680) / 488);

/**
 * A card name that shows the card's image while hovered or focused (and on a tap), like
 * Moxfield's deck lists: a list of names alone doesn't show what a deck is.
 */
export function NamePreview(props: {
  printing: PrintingCard | undefined;
  name: string;
  onSelect?: () => void;
  className?: string;
}) {
  const [spot, setSpot] = useState<PreviewSpot | null>(null);
  const nameRef = useRef<HTMLButtonElement>(null);
  const suppressedRef = useRef(false);

  function show() {
    if (suppressedRef.current) return;
    const box = nameRef.current?.getBoundingClientRect();
    if (box === undefined || props.printing === undefined) return;
    // To the left of the name when there's room (deck lists sit on the right), else the right.
    const left =
      box.left - PREVIEW_WIDTH - 12 >= 8
        ? box.left - PREVIEW_WIDTH - 12
        : Math.min(box.right + 12, window.innerWidth - PREVIEW_WIDTH - 8);
    const top = Math.max(8, Math.min(box.top - 40, window.innerHeight - PREVIEW_HEIGHT - 8));
    setSpot({ left, top });
  }

  function handleFocus() {
    if (nameRef.current?.matches(":focus-visible")) show();
  }

  function handleClick() {
    if (props.onSelect) {
      suppressedRef.current = true;
      setSpot(null);
      props.onSelect();
    } else if (spot) {
      setSpot(null);
    } else {
      suppressedRef.current = false;
      show();
    }
  }

  return (
    <>
      <button
        ref={nameRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={() => {
          suppressedRef.current = false;
          setSpot(null);
        }}
        onFocus={handleFocus}
        onBlur={() => setSpot(null)}
        onClick={handleClick}
        className={`truncate text-left hover:underline ${props.className ?? ""}`}
      >
        {props.name}
      </button>
      {spot && props.printing?.hasImage && (
        <CardImage
          src={`/api/images/${props.printing.id}/normal/front`}
          decorative
          aria-hidden
          data-card-preview
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          className="pointer-events-none fixed z-50 rounded-[4.5%] shadow-2xl ring-1 ring-black/30"
          style={{ left: spot.left, top: spot.top, width: PREVIEW_WIDTH }}
        />
      )}
    </>
  );
}
