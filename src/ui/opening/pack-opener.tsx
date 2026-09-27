"use client";
// Plays a sequence of packs (design doc 08): tear, deal, flip card by card, summary. The state
// lives in a pure reducer (machine.ts); this component only draws it and sends events. The
// cards were decided on the server, so nothing here can change a pull.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ProductArt } from "../product-art";
import { CardBack } from "./card-back";
import {
  hitLevel,
  initialState,
  openingReducer,
  packValueCents,
  revealedCount,
  type OpenerCard,
  type OpenerPack,
  type OpeningEvent,
  type OpeningState,
} from "./machine";
import { makeSounds, useMuted, useReducedMotion } from "./sounds";

const TEAR_MILLISECONDS = 900;
const PRELOAD_WAIT_MILLISECONDS = 3000; // rule 7: wait this long at most for images
const SUSPENSE_MILLISECONDS = { rare: 900, mythic: 1600 };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
// The large size (672 × 936): the spotlight and the phone stack show cards big enough to read,
// and the grid's thumbnails reuse the same file, so each card downloads once.
const imageUrl = (card: OpenerCard) => `/api/images/${card.printingId}/large/front`;

/** Loads every card image in the background; resolves when they're all in (or failed). */
function preload(cards: readonly OpenerCard[]): Promise<void> {
  const loads = cards
    .filter((card) => card.hasImage)
    .map(
      (card) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve(); // a missing image shouldn't block the opening
          image.src = imageUrl(card);
        }),
    );
  return Promise.all(loads).then(() => undefined);
}

function waitAtMost(promise: Promise<void>, milliseconds: number): Promise<void> {
  return Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, milliseconds))]);
}

type PackOpenerProps = {
  packs: readonly OpenerPack[];
  /** Shown once every pack has been opened (the static results). */
  children: React.ReactNode;
};

export function PackOpener(props: PackOpenerProps) {
  const { packs } = props;
  const [state, send] = useReducer(
    (current: OpeningState, event: OpeningEvent) => openingReducer(packs, current, event),
    packs,
    initialState,
  );
  const [muted, toggleMuted] = useMuted();
  const reducedMotion = useReducedMotion();
  const sounds = useMemo(() => makeSounds(), []);
  const [suspenseIndex, setSuspenseIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** A revealed card clicked in the grid, shown in the spotlight instead of the newest one. */
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const preloads = useRef(new Map<number, Promise<void>>());

  // Start loading every pack's images straight away (rule 7).
  useEffect(() => {
    for (const pack of packs) preloads.current.set(pack.itemId, preload(pack.cards));
  }, [packs]);

  const pack = state.phase === "finished" ? null : packs[state.pack];
  const revealed = pack === null ? 0 : revealedCount(state, pack);

  const tear = useCallback(() => {
    if (state.phase !== "sealed" || pack === null) return;
    send({ type: "tear" });
    if (!muted) sounds?.tear();
    const images = preloads.current.get(pack.itemId) ?? Promise.resolve();
    const minimum = new Promise<void>((resolve) =>
      setTimeout(resolve, reducedMotion ? 0 : TEAR_MILLISECONDS),
    );
    void Promise.all([minimum, waitAtMost(images, PRELOAD_WAIT_MILLISECONDS)]).then(() =>
      send({ type: "tearFinished" }),
    );
  }, [state.phase, pack, muted, sounds, reducedMotion]);

  /** Flip the next card: hits get a build-up first (rule 3). */
  const revealNext = useCallback(() => {
    if (state.phase !== "revealing" || pack === null || suspenseIndex !== null) return;
    const card = pack.cards[state.revealed];
    const level = hitLevel(card);
    const flip = () => {
      send({ type: "revealNext" });
      setSuspenseIndex(null);
      setFocusedIndex(null);
      setAnnouncement(
        `${card.name}, ${card.rarity}${card.finish === "nonfoil" ? "" : `, ${card.finish}`}`,
      );
      if (muted) return;
      if (level === "none") sounds?.flip();
      else sounds?.hit(level);
    };
    if (level === "none" || reducedMotion) {
      flip();
    } else {
      setSuspenseIndex(state.revealed);
      setTimeout(flip, SUSPENSE_MILLISECONDS[level]);
    }
  }, [state, pack, suspenseIndex, muted, sounds, reducedMotion]);

  // Space or Enter reveals the next card (rule 4).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea, a")) return;
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (state.phase === "sealed") tear();
      else revealNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.phase, tear, revealNext]);

  if (state.phase === "finished" || pack === null) return <>{props.children}</>;

  const bestCard = pack.cards.reduce((best, card) =>
    (card.priceCents ?? 0) > (best.priceCents ?? 0) ? card : best,
  );
  const isLastPack = state.pack === packs.length - 1;

  return (
    <section aria-label="Opening" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">
          Pack {state.pack + 1} of {packs.length}: {pack.name}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={toggleMuted} className="underline" aria-pressed={muted}>
          {muted ? "Sound off" : "Sound on"}
        </button>
        <button type="button" onClick={() => send({ type: "skipToEnd" })} className="underline">
          Skip to the end
        </button>
      </div>

      {(state.phase === "sealed" || state.phase === "tearing") && (
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={tear}
            disabled={state.phase === "tearing"}
            aria-label={`Tear open ${pack.name}`}
            className={`relative w-56 ${state.phase === "tearing" ? "animate-pack-away" : "transition-transform hover:scale-105 hover:-rotate-1"}`}
          >
            <ProductArt
              setCode={pack.setCode}
              setName={pack.setName}
              keyruneCode={pack.keyruneCode}
              label={pack.label}
              shape="pack"
              featuredPrintingId={pack.featuredPrintingId}
            />
            {/* The strip that tears off along the top. */}
            <span
              aria-hidden
              className={`absolute inset-x-0 top-0 h-[9%] rounded-t-sm bg-white/30 ${state.phase === "tearing" ? "animate-tear-strip" : ""}`}
            />
          </button>
          <p className="text-sm text-zinc-500">
            {state.phase === "sealed" ? "Click the pack (or press Space) to tear it open." : "…"}
          </p>
        </div>
      )}

      {(state.phase === "revealing" || state.phase === "summary") && (
        <>
          {/* Phones: a stack you go through one card at a time, like holding the pack. */}
          <div className="md:hidden">
            <RevealStack
              cards={pack.cards}
              revealed={revealed}
              suspenseIndex={suspenseIndex}
              canReveal={state.phase === "revealing"}
              onReveal={revealNext}
            />
          </div>

          {/* Larger screens: the whole pack in a grid, and the newest card (or the one you
              clicked) full size in the spotlight, where its text is readable. */}
          <div className="hidden items-start gap-6 md:flex">
            <Spotlight
              card={
                focusedIndex !== null
                  ? pack.cards[focusedIndex]
                  : revealed > 0
                    ? pack.cards[revealed - 1]
                    : null
              }
            />
            <ol className="grid flex-1 grid-cols-5 gap-3 lg:grid-cols-7">
              {pack.cards.map((card, index) => (
                <RevealSlot
                  key={`${pack.itemId}-${index}`}
                  card={card}
                  index={index}
                  isFaceUp={index < revealed}
                  isNext={state.phase === "revealing" && index === revealed}
                  isInSuspense={suspenseIndex === index}
                  onReveal={revealNext}
                  onFocus={() => setFocusedIndex(index)}
                />
              ))}
            </ol>
          </div>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>

          {state.phase === "revealing" ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={revealNext}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Reveal next
              </button>
              <button
                type="button"
                onClick={() => send({ type: "revealAll" })}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
              >
                Reveal all
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p>
                This pack is worth{" "}
                <strong className="tabular-nums">{dollars(packValueCents(pack))}</strong> at market
                price. Best card: <strong>{bestCard.name}</strong>
                {bestCard.priceCents !== null && ` (${dollars(bestCard.priceCents)})`}.
              </p>
              <button
                type="button"
                onClick={() => send({ type: "nextPack" })}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                {isLastPack ? "Done" : "Next pack"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** A card's face: its image, with the moving foil shimmer on foils. */
function CardFace(props: { card: OpenerCard }) {
  const { card } = props;
  return (
    <div className="relative overflow-hidden rounded-[4.5%]">
      {card.hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl(card)}
          alt=""
          className="aspect-[488/680] w-full bg-zinc-200 dark:bg-zinc-800"
        />
      ) : (
        <div className="flex aspect-[488/680] w-full items-center justify-center bg-zinc-200 p-2 text-center dark:bg-zinc-800">
          {card.name}
        </div>
      )}
      {card.finish !== "nonfoil" && <span aria-hidden className="foil-shimmer absolute inset-0" />}
    </div>
  );
}

const GLOW = { rare: "glow-rare", mythic: "glow-mythic", none: "" };

/** "Borderless · foil · $9.56" */
function cardDetails(card: OpenerCard): string {
  return [
    card.variantLabel,
    card.finish === "nonfoil" ? "" : card.finish,
    card.priceCents === null ? "no price" : dollars(card.priceCents),
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

function CardCaption(props: { card: OpenerCard }) {
  return (
    <p className="text-sm leading-tight">
      <span className="font-medium">{props.card.name}</span>
      <br />
      <span className="text-zinc-500">{cardDetails(props.card)}</span>
    </p>
  );
}

/** The card being looked at, full size (larger screens). */
function Spotlight(props: { card: OpenerCard | null }) {
  const { card } = props;
  return (
    <aside aria-label="Spotlight" className="flex w-72 shrink-0 flex-col gap-2 lg:w-80">
      {card === null ? (
        <>
          <CardBack />
          <p className="text-sm text-zinc-500">
            Each card appears here, full size, as you flip it.
          </p>
        </>
      ) : (
        <>
          <div
            key={card.printingId}
            className={`animate-flip-in rounded-[4.5%] ${GLOW[hitLevel(card)]}`}
          >
            <CardFace card={card} />
          </div>
          <CardCaption card={card} />
        </>
      )}
    </aside>
  );
}

/**
 * Phones: one card at a time. Tap the stack to flip the next card; it lands on top, full width.
 * During suspense the face-down card on top shakes and glows first.
 */
function RevealStack(props: {
  cards: readonly OpenerCard[];
  revealed: number;
  suspenseIndex: number | null;
  canReveal: boolean;
  onReveal: () => void;
}) {
  const { cards, revealed } = props;
  const inSuspense = props.suspenseIndex !== null;
  const faceUp = revealed > 0 && !inSuspense;
  const top = faceUp ? cards[revealed - 1] : cards[Math.min(revealed, cards.length - 1)];
  const stillFaceDown = cards.length - revealed - (faceUp ? 0 : 1);
  const glow = faceUp || inSuspense ? GLOW[hitLevel(top)] : "";

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={props.canReveal ? props.onReveal : undefined}
        disabled={!props.canReveal}
        aria-label={props.canReveal ? "Flip the next card" : top.name}
        className="relative w-full max-w-xs"
      >
        {/* The rest of the pack, peeking out underneath. */}
        {stillFaceDown > 0 && (
          <div aria-hidden className="absolute inset-0 translate-x-2 translate-y-2">
            <CardBack />
          </div>
        )}
        <div
          key={`${revealed}-${faceUp}`}
          className={`relative rounded-[4.5%] ${faceUp ? "animate-flip-in" : ""} ${inSuspense ? "animate-suspense" : ""} ${glow}`}
        >
          {faceUp ? <CardFace card={top} /> : <CardBack />}
        </div>
      </button>
      {faceUp ? <CardCaption card={top} /> : <p className="text-sm text-zinc-500">Tap to flip</p>}
      <p className="text-xs text-zinc-500">
        {revealed} of {cards.length} flipped
      </p>
      {/* The cards you've already seen, small. */}
      {revealed > 1 && (
        <ol className="grid w-full grid-cols-7 gap-1">
          {cards.slice(0, revealed).map((card, index) => (
            <li key={index}>
              <CardFace card={card} />
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
  isInSuspense: boolean;
  onReveal: () => void;
  /** Show this (face-up) card in the spotlight. */
  onFocus: () => void;
};

function RevealSlot(props: RevealSlotProps) {
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
        className={`flip-card block w-full rounded-[4.5%] ${props.isNext && !props.isInSuspense ? "cursor-pointer ring-2 ring-zinc-400 ring-offset-2" : ""} ${props.isInSuspense ? "animate-suspense" : ""}`}
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
