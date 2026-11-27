"use client";
import { Cents } from "@/shared/kernel";
import { CardArt, type CardFaceSide, type CardStepping } from "@/ui/mtg/card-art";
import { CardImage } from "@/ui/mtg/card-image";
import { CardBack } from "./card-back";
import { hitLevel, type OpenerCard } from "./machine";

// The large size (672 × 936): the spotlight and the phone stack show cards big enough to read,
// and the grid's thumbnails reuse the same file, so each card downloads once.
export const openerImageUrl = (card: OpenerCard, face: CardFaceSide = "front") =>
  `/api/images/${card.printingId}/large/${face}`;

const GLOW = { rare: "glow-rare", mythic: "glow-mythic", none: "" };

const STEP_BUTTON = [
  "border-line text-muted hover:text-foreground",
  "flex h-11 w-11 items-center justify-center rounded-md border text-lg disabled:opacity-35",
].join(" ");

/** A card's static thumbnail face (used in the desktop reveal grid and phone strip). */
function CardFace(props: { card: OpenerCard }) {
  const { card } = props;
  return (
    <div className="relative overflow-hidden rounded-[4.5%]">
      {card.hasImage ? (
        <CardImage
          src={openerImageUrl(card)}
          decorative
          className="bg-surface-raised aspect-[488/680] w-full"
        />
      ) : (
        <div className="bg-surface-raised flex aspect-[488/680] w-full items-center justify-center p-2 text-center">
          {card.name}
        </div>
      )}
      {card.finish !== "nonfoil" && <span aria-hidden className="foil-shimmer absolute inset-0" />}
    </div>
  );
}

/** "Borderless · foil · $9.56" */
function cardDetails(card: OpenerCard): string {
  return [
    card.variantLabel,
    card.finish === "nonfoil" ? "" : card.finish,
    card.priceCents === null ? "no price" : Cents.format(Cents.of(card.priceCents)),
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

function CardCaption(props: { card: OpenerCard }) {
  return (
    <p className="text-sm leading-tight">
      <span className="font-medium">{props.card.name}</span>
      <br />
      <span className="text-muted">{cardDetails(props.card)}</span>
    </p>
  );
}

/** Previous / Next controls matching DeckSteps: step back through revealed cards or flip next. */
function PackSteps(props: {
  position: number;
  total: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div role="group" aria-label="Step through the pack" className="flex items-center gap-2">
      <button
        type="button"
        onClick={props.onPrevious}
        disabled={!props.canGoPrevious}
        aria-label="Previous card in pack"
        className={STEP_BUTTON}
      >
        ‹
      </button>
      <span className="text-muted min-w-14 text-center text-xs tabular-nums">
        {props.position} / {props.total}
      </span>
      <button
        type="button"
        onClick={props.onNext}
        disabled={!props.canGoNext}
        aria-label="Next card in pack"
        className={STEP_BUTTON}
      >
        ›
      </button>
    </div>
  );
}

/** The card being looked at, full size (larger screens), with carousel edge taps & DFC flip. */
export function Spotlight(props: {
  card: OpenerCard | null;
  position: number;
  total: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { card } = props;
  const stepping: CardStepping = {
    position: props.position,
    total: props.total,
    canGoPrevious: props.canGoPrevious,
    canGoNext: props.canGoNext,
    onPrevious: props.onPrevious,
    onNext: props.onNext,
  };
  return (
    <aside aria-label="Spotlight" className="flex w-72 shrink-0 flex-col gap-3 lg:w-80">
      {card === null ? (
        <>
          <CardBack />
          <p className="text-muted text-sm">Each card appears here, full size, as you flip it.</p>
        </>
      ) : (
        <>
          <div
            key={`${card.printingId}-${props.position}`}
            className={`animate-flip-in rounded-[4.5%] ${GLOW[hitLevel(card)]}`}
          >
            <CardArt
              printingId={card.printingId}
              name={card.name}
              size="large"
              hasImage={card.hasImage}
              hasBackImage={card.hasBackImage}
              stepping={stepping}
              decorative
              overlay={
                card.finish !== "nonfoil" ? (
                  <span aria-hidden className="foil-shimmer pointer-events-none absolute inset-0" />
                ) : undefined
              }
            />
          </div>
          <CardCaption card={card} />
        </>
      )}
      <PackSteps
        position={props.position}
        total={props.total}
        canGoPrevious={props.canGoPrevious}
        canGoNext={props.canGoNext}
        onPrevious={props.onPrevious}
        onNext={props.onNext}
      />
    </aside>
  );
}

/**
 * Phones: one card at a time. Tap the face-down stack to reveal the first card; once face up,
 * tap the left/right edges (or swipe, or press ‹ / ›) to step through revealed cards or flip the
 * next one, and use the Flip button on two-sided cards.
 */
export function RevealStack(props: {
  cards: readonly OpenerCard[];
  revealed: number;
  currentIndex: number | null;
  suspenseIndex: number | null;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
}) {
  const { cards, revealed, currentIndex } = props;
  const inSuspense = props.suspenseIndex !== null;
  const faceUp = currentIndex !== null && !inSuspense;
  const topIndex = faceUp ? currentIndex : Math.min(revealed, cards.length - 1);
  const top = cards[topIndex];
  const stillFaceDown = cards.length - revealed - (faceUp ? 0 : 1);
  const glow = faceUp || inSuspense ? GLOW[hitLevel(top)] : "";
  const stepping: CardStepping = {
    position: faceUp ? topIndex + 1 : 0,
    total: cards.length,
    canGoPrevious: props.canGoPrevious,
    canGoNext: props.canGoNext,
    onPrevious: props.onPrevious,
    onNext: props.onNext,
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full max-w-xs">
        {stillFaceDown > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 translate-x-2 translate-y-2"
          >
            <CardBack />
          </div>
        )}
        {faceUp ? (
          <div key={`${topIndex}-up`} className={`animate-flip-in relative rounded-[4.5%] ${glow}`}>
            <CardArt
              printingId={top.printingId}
              name={top.name}
              size="large"
              hasImage={top.hasImage}
              hasBackImage={top.hasBackImage}
              stepping={stepping}
              decorative
              overlay={
                top.finish !== "nonfoil" ? (
                  <span aria-hidden className="foil-shimmer pointer-events-none absolute inset-0" />
                ) : undefined
              }
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={props.onNext}
            disabled={!props.canGoNext}
            aria-label={props.canGoNext ? "Reveal next card" : top.name}
            className="relative block w-full cursor-pointer"
          >
            <div
              key={`${topIndex}-down`}
              className={`relative rounded-[4.5%] ${inSuspense ? "animate-suspense" : ""} ${glow}`}
            >
              <CardBack />
            </div>
          </button>
        )}
      </div>

      <PackSteps
        position={faceUp ? topIndex + 1 : 0}
        total={cards.length}
        canGoPrevious={props.canGoPrevious}
        canGoNext={props.canGoNext}
        onPrevious={props.onPrevious}
        onNext={props.onNext}
      />

      {faceUp ? <CardCaption card={top} /> : <p className="text-muted text-sm">Tap to flip</p>}
      <p className="text-muted text-xs">
        {revealed} of {cards.length} flipped
      </p>

      {revealed > 1 && (
        <ol className="grid w-full grid-cols-7 gap-1">
          {cards.slice(0, revealed).map((card, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => props.onSelect(index)}
                aria-label={`Show ${card.name}`}
                className={`block w-full rounded-[4.5%] ${index === topIndex && faceUp ? "ring-2 ring-sky-500" : ""}`}
              >
                <CardFace card={card} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type RevealSlotProps = {
  card: OpenerCard;
  index: number;
  isFaceUp: boolean;
  isNext: boolean;
  isFocused: boolean;
  isInSuspense: boolean;
  onReveal: () => void;
  onFocus: () => void;
};

export function RevealSlot(props: RevealSlotProps) {
  const { card } = props;
  const glow = props.isFaceUp || props.isInSuspense ? GLOW[hitLevel(card)] : "";

  return (
    <li
      className="animate-deal flex flex-col gap-1 text-xs"
      style={{ animationDelay: `${props.index * 60}ms` }}
    >
      <button
        type="button"
        onClick={props.isNext ? props.onReveal : props.isFaceUp ? props.onFocus : undefined}
        disabled={!props.isNext && !props.isFaceUp}
        aria-label={props.isFaceUp ? card.name : `Face-down card ${props.index + 1}`}
        className={`flip-card block w-full rounded-[4.5%] ${
          props.isFocused
            ? "ring-2 ring-sky-500 ring-offset-2"
            : props.isNext && !props.isInSuspense
              ? "ring-muted cursor-pointer ring-2 ring-offset-2"
              : ""
        } ${props.isInSuspense ? "animate-suspense" : ""}`}
      >
        <div className={`flip-inner rounded-[4.5%] ${glow} ${props.isFaceUp ? "is-flipped" : ""}`}>
          <div className="flip-face">
            <CardBack />
          </div>
          <div className="flip-face flip-front">
            <CardFace card={card} />
          </div>
        </div>
      </button>
      {props.isFaceUp && <span className="leading-tight font-medium">{card.name}</span>}
    </li>
  );
}
