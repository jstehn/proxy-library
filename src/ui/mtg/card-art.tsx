"use client";
// The shared interactive card-art stage (design doc 73): displays a card's artwork with optional
// 3D two-sided flip (when `hasBackImage` is true) and left/right carousel tap zones + horizontal
// touch swipe (when `stepping` is provided).
import { useRef, useState, type ReactNode } from "react";
import {
  detectSwipeDirection,
  resolveCardFace,
  toggleCardFace,
  type CardFaceSide,
  type CardStepping,
  type FaceSelection,
} from "./card-art-logic";
import { CardImage } from "./card-image";

export type { CardFaceSide, CardStepping } from "./card-art-logic";

const CARD_FRAME = "bg-surface-raised aspect-[488/680] h-auto w-full rounded-[4.5%]";
const STEP_EDGE_BASE = [
  "absolute inset-y-0 z-10 flex w-[28%] items-center",
  "enabled:cursor-pointer disabled:pointer-events-none",
].join(" ");
const EDGE_CUE = [
  "carousel-edge-cue flex h-9 w-9 items-center justify-center rounded-full",
  "bg-black/65 text-xl leading-none text-white shadow-sm ring-1 ring-white/25 transition-opacity",
].join(" ");
const FLIP_PILL = [
  "absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 cursor-pointer items-center gap-1",
  "rounded-full border border-white/25 bg-black/80 px-3.5 py-1.5 text-xs font-medium",
  "text-white shadow-lg transition hover:bg-black/95 active:scale-95",
].join(" ");

export type CardArtProps = Readonly<{
  printingId: string;
  name: string;
  size?: "normal" | "large";
  hasImage?: boolean;
  hasBackImage?: boolean;
  /** Controlled face; when omitted, CardArt tracks flip state per printingId. */
  face?: CardFaceSide;
  onFlip?: () => void;
  stepping?: CardStepping | null;
  /** Optional visual overlay rendered over the card face (e.g. foil shimmer). */
  overlay?: ReactNode;
  /** Mark the image decorative when surrounding text already names the card. */
  decorative?: boolean;
  className?: string;
}>;

export function CardArt(props: CardArtProps) {
  const {
    printingId,
    name,
    size = "normal",
    hasImage = true,
    hasBackImage = false,
    stepping = null,
    overlay,
    decorative = false,
    className = "",
  } = props;

  const [internalFace, setInternalFace] = useState<FaceSelection | null>(null);
  const [loadedBackFor, setLoadedBackFor] = useState<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const activeFace: CardFaceSide =
    props.face !== undefined
      ? hasBackImage
        ? props.face
        : "front"
      : resolveCardFace(internalFace, printingId, hasBackImage);

  const showBackImage = hasBackImage && (activeFace === "back" || loadedBackFor === printingId);

  function handleFlip() {
    if (!hasBackImage) return;
    setLoadedBackFor(printingId);
    if (props.onFlip) {
      props.onFlip();
    } else {
      setInternalFace((current) => toggleCardFace(current, printingId, hasBackImage));
    }
  }

  const canStep = stepping !== null && stepping.total > 1;
  const canGoPrevious = canStep && (stepping.canGoPrevious ?? true);
  const canGoNext = canStep && (stepping.canGoNext ?? true);

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (!canStep || event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (start === null || !canStep || event.changedTouches.length !== 1) return;
    const end = event.changedTouches[0];
    const direction = detectSwipeDirection(end.clientX - start.x, end.clientY - start.y);
    if (direction === "previous" && canGoPrevious) stepping.onPrevious();
    else if (direction === "next" && canGoNext) stepping.onNext();
  }

  const frontImage = hasImage ? (
    <CardImage
      src={`/api/images/${printingId}/${size}/front`}
      {...(decorative ? { decorative: true as const } : { alt: name })}
      width={488}
      height={680}
      className={`${CARD_FRAME} shadow-md`}
    />
  ) : (
    <div
      className={`${CARD_FRAME} text-muted flex items-center justify-center p-3 text-center text-sm shadow-md`}
    >
      {name}
    </div>
  );

  const backImage =
    hasImage && showBackImage ? (
      <CardImage
        src={`/api/images/${printingId}/${size}/back`}
        {...(decorative ? { decorative: true as const } : { alt: `${name} (back face)` })}
        width={488}
        height={680}
        className={`${CARD_FRAME} shadow-md`}
      />
    ) : (
      <div className={`${CARD_FRAME} shadow-md`} />
    );

  return (
    <div
      className={`carousel-stage relative select-none ${canStep ? "touch-pan-y" : ""} ${className}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {hasBackImage ? (
        <div className="flip-card">
          <div className={`flip-inner rounded-[4.5%] ${activeFace === "back" ? "is-flipped" : ""}`}>
            <div className="flip-face relative overflow-hidden rounded-[4.5%]">
              {frontImage}
              {overlay}
            </div>
            <div className="flip-face flip-front overflow-hidden rounded-[4.5%]">
              {backImage}
              {overlay}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-[4.5%]">
          {frontImage}
          {overlay}
        </div>
      )}

      {canStep && (
        <>
          <button
            type="button"
            onClick={stepping.onPrevious}
            disabled={!canGoPrevious}
            aria-label="Previous card"
            className={`${STEP_EDGE_BASE} left-0 justify-start rounded-l-[4.5%] pl-2`}
          >
            {canGoPrevious && (
              <span aria-hidden className={EDGE_CUE}>
                ‹
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={stepping.onNext}
            disabled={!canGoNext}
            aria-label="Next card"
            className={`${STEP_EDGE_BASE} right-0 justify-end rounded-r-[4.5%] pr-2`}
          >
            {canGoNext && (
              <span aria-hidden className={EDGE_CUE}>
                ›
              </span>
            )}
          </button>
        </>
      )}

      {hasBackImage && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handleFlip();
          }}
          aria-pressed={activeFace === "back"}
          aria-label={activeFace === "back" ? "Show front face" : "Show back face"}
          className={FLIP_PILL}
        >
          <span aria-hidden>↻</span>
          <span>{activeFace === "back" ? "Front" : "Flip"}</span>
        </button>
      )}
    </div>
  );
}
