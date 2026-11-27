"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CardFace, PrintingCard } from "@/modules/catalog";
import { Dialog } from "@/ui/dialog";
import {
  resolveCardFace,
  toggleCardFace,
  type CardStepping,
  type FaceSelection,
} from "@/ui/mtg/card-art-logic";
import { CardView } from "@/ui/mtg/card-view";
import { ManaText } from "@/ui/mtg/mana";
import { CardImage } from "@/ui/mtg/card-image";

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

/**
 * Unified modal card preview (design doc 73): built on the shared native `<Dialog>` with
 * light-dismiss, two-sided card flipping, optional carousel stepping (left/right edge tap,
 * horizontal swipe, and ArrowLeft/ArrowRight), and Image/Text/Both toggle on phones.
 */
export function CardPreviewDialog(props: {
  printing: PrintingCard;
  open: boolean;
  onClose: () => void;
  stepping?: CardStepping | null;
  href?: string;
}) {
  const { printing, open, onClose, stepping = null, href } = props;
  const [faceSelection, setFaceSelection] = useState<FaceSelection | null>(null);
  const activeFace = resolveCardFace(faceSelection, printing.id, printing.hasBackImage);

  const flip = () => {
    if (!printing.hasBackImage) return;
    setFaceSelection((current) => toggleCardFace(current, printing.id, printing.hasBackImage));
  };

  // Keep latest handlers in a ref so the keyboard listener only attaches while the dialog is open.
  const latestRef = useRef({ stepping, hasBackImage: printing.hasBackImage, flip });
  useEffect(() => {
    latestRef.current = { stepping, hasBackImage: printing.hasBackImage, flip };
  });

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }
      const { stepping: currentStepping, hasBackImage, flip: currentFlip } = latestRef.current;
      if (
        event.key === "ArrowLeft" &&
        currentStepping !== null &&
        (currentStepping.canGoPrevious ?? currentStepping.total > 1)
      ) {
        event.preventDefault();
        currentStepping.onPrevious();
      } else if (
        event.key === "ArrowRight" &&
        currentStepping !== null &&
        (currentStepping.canGoNext ?? currentStepping.total > 1)
      ) {
        event.preventDefault();
        currentStepping.onNext();
      } else if (event.key.toLowerCase() === "f" && hasBackImage) {
        event.preventDefault();
        currentFlip();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const title =
    stepping !== null && stepping.total > 1
      ? `${printing.name} (${stepping.position} / ${stepping.total})`
      : printing.name;

  const credit = [printing.variantLabel, printing.artist && `Illustrated by ${printing.artist}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog open={open} onClose={onClose} title={title} size="lg" showCloseButton>
      <CardView
        printingId={printing.id}
        name={printing.name}
        hasImage={printing.hasImage}
        hasBackImage={printing.hasBackImage}
        face={activeFace}
        onFlip={flip}
        stepping={stepping}
        faces={printing.faces}
        credit={credit}
        layout="responsive"
        desktopImage="wide"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted">
            {printing.setCode.toUpperCase()} #{printing.collectorNumber} · {printing.rarity}
          </span>
          {href && (
            <Link href={href} onClick={onClose} className="font-medium underline">
              Open card page
            </Link>
          )}
        </div>
      </CardView>
    </Dialog>
  );
}

/**
 * A card's full image that opens the enlarged, readable version on hover/focus and the modal
 * preview on click/tap. Used for a Commander deck's commander in the store and in deck lists.
 */
export function CardWithPreview(props: {
  printing: PrintingCard;
  caption?: string;
  /** Optional override when clicking/tapping (e.g. to open a deck-wide carousel). */
  onOpenPreview?: () => void;
}) {
  const { printing, onOpenPreview } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [align, setAlign] = useState<"center" | "left" | "right">("center");
  const frameRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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
    setIsOpen(false);
    if (onOpenPreview !== undefined) {
      onOpenPreview();
    } else {
      setIsDialogOpen(true);
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
        aria-label={`${printing.name}: show card details`}
        className="block w-full cursor-pointer rounded-[4.5%]"
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
      {onOpenPreview === undefined && isDialogOpen && (
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
    if (window.matchMedia("(pointer: coarse)").matches) return;
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
