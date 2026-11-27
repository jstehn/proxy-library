"use client";
// Plays a sequence of packs (design doc 08): tear, deal, flip card by card, summary. The state
// lives in a pure reducer (machine.ts); this component only draws it and sends events. The
// cards were decided on the server, so nothing here can change a pull.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Cents } from "@/shared/kernel";
import { ProductImage } from "@/ui/mtg/product-image";
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
import { openerImageUrl, RevealSlot, RevealStack, Spotlight } from "./pack-views";
import { makeSounds, useMuted, useReducedMotion } from "./sounds";

const TEAR_MILLISECONDS = 900;
const PRELOAD_WAIT_MILLISECONDS = 3000; // rule 7: wait this long at most for images
const SUSPENSE_MILLISECONDS = { rare: 900, mythic: 1600 };

/** Loads every card image (front and, for double-faced cards, back) in the background. */
function preload(cards: readonly OpenerCard[]): Promise<void> {
  const urls = cards.flatMap((card) => {
    if (!card.hasImage) return [];
    return card.hasBackImage
      ? [openerImageUrl(card, "front"), openerImageUrl(card, "back")]
      : [openerImageUrl(card, "front")];
  });
  const loads = urls.map(
    (url) =>
      new Promise<void>((resolve) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => resolve(); // a missing image shouldn't block the opening
        image.src = url;
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

  const currentPackIndex = state.phase === "finished" ? null : state.pack;

  // Preload only the current and next pack so opening a large bundle doesn't flood the server.
  useEffect(() => {
    if (currentPackIndex === null) return;
    for (const index of [currentPackIndex, currentPackIndex + 1]) {
      const candidate = packs[index];
      if (candidate !== undefined && !preloads.current.has(candidate.itemId)) {
        preloads.current.set(candidate.itemId, preload(candidate.cards));
      }
    }
  }, [packs, currentPackIndex]);

  const pack = state.phase === "finished" ? null : packs[state.pack];
  const revealed = pack === null ? 0 : revealedCount(state, pack);
  const currentIndex =
    focusedIndex !== null && focusedIndex < revealed
      ? focusedIndex
      : revealed > 0
        ? revealed - 1
        : null;

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

  const canGoPrevious = suspenseIndex === null && currentIndex !== null && currentIndex > 0;
  const canGoNext =
    suspenseIndex === null &&
    pack !== null &&
    ((currentIndex !== null && currentIndex < revealed - 1) || state.phase === "revealing");

  const goPrevious = useCallback(() => {
    if (!canGoPrevious || currentIndex === null) return;
    setFocusedIndex(currentIndex - 1);
  }, [canGoPrevious, currentIndex]);

  const goNext = useCallback(() => {
    if (!canGoNext) return;
    if (currentIndex !== null && currentIndex < revealed - 1) {
      const next = currentIndex + 1;
      setFocusedIndex(next === revealed - 1 ? null : next);
    } else if (state.phase === "revealing") {
      revealNext();
    }
  }, [canGoNext, currentIndex, revealed, state.phase, revealNext]);

  // Space/Enter reveals the next card; ArrowLeft/ArrowRight step back and forth through the pack.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea, a")) return;
      if (event.key === "ArrowLeft" && (state.phase === "revealing" || state.phase === "summary")) {
        event.preventDefault();
        goPrevious();
        return;
      }
      if (
        event.key === "ArrowRight" &&
        (state.phase === "revealing" || state.phase === "summary")
      ) {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (state.phase === "sealed") tear();
      else revealNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.phase, tear, revealNext, goPrevious, goNext]);

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
          {pack.theme !== null && (state.phase === "revealing" || state.phase === "summary") && (
            <> · Theme: {pack.theme}</>
          )}
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
        <div className="flex flex-col items-center gap-4 py-4">
          <button
            type="button"
            onClick={tear}
            disabled={state.phase === "tearing"}
            aria-label={`Tear open ${pack.name}`}
            className={`group relative w-56 ${state.phase === "sealed" ? "cursor-pointer transition-transform duration-200 hover:scale-105 hover:-rotate-1" : ""}`}
          >
            {state.phase === "sealed" ? (
              <ProductImage
                photoIds={pack.photoIds}
                variant={pack.photoVariant}
                sizes="224px"
                setCode={pack.setCode}
                setName={pack.setName}
                keyruneCode={pack.keyruneCode}
                label={pack.label}
                shape="pack"
                featuredPrintingId={pack.featuredPrintingId}
              />
            ) : (
              <div className="relative w-full">
                <div
                  aria-hidden
                  className="animate-pack-cards-emerge pointer-events-none absolute inset-x-6 top-6 z-0"
                >
                  <div className="relative">
                    <div className="absolute inset-0 -rotate-6 opacity-80">
                      <CardBack />
                    </div>
                    <div className="relative rotate-3">
                      <CardBack />
                    </div>
                  </div>
                </div>
                <div className="pack-tear-bottom animate-pack-tear-bottom relative z-10">
                  <ProductImage
                    photoIds={pack.photoIds}
                    variant={pack.photoVariant}
                    sizes="224px"
                    setCode={pack.setCode}
                    setName={pack.setName}
                    keyruneCode={pack.keyruneCode}
                    label={pack.label}
                    shape="pack"
                    featuredPrintingId={pack.featuredPrintingId}
                  />
                </div>
                <span
                  aria-hidden
                  className="animate-pack-tear-flash pointer-events-none absolute inset-x-2 top-[15%] z-20 h-2 blur-sm"
                  style={{ backgroundColor: "rgb(252 211 77 / 0.9)" }}
                />
                <div
                  aria-hidden
                  className="pack-tear-top animate-pack-tear-top pointer-events-none absolute inset-0 z-30"
                >
                  <ProductImage
                    photoIds={pack.photoIds}
                    variant={pack.photoVariant}
                    sizes="224px"
                    setCode={pack.setCode}
                    setName={pack.setName}
                    keyruneCode={pack.keyruneCode}
                    label={pack.label}
                    shape="pack"
                    featuredPrintingId={pack.featuredPrintingId}
                  />
                </div>
              </div>
            )}
          </button>
          <p className="text-muted text-sm">
            {state.phase === "sealed"
              ? "Click the pack (or press Space) to tear it open."
              : "Opening…"}
          </p>
        </div>
      )}

      {(state.phase === "revealing" || state.phase === "summary") && (
        <>
          <div className="md:hidden">
            <RevealStack
              cards={pack.cards}
              revealed={revealed}
              currentIndex={currentIndex}
              suspenseIndex={suspenseIndex}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
              onPrevious={goPrevious}
              onNext={goNext}
              onSelect={(index) => setFocusedIndex(index === revealed - 1 ? null : index)}
            />
          </div>

          <div className="hidden items-start gap-6 md:flex">
            <Spotlight
              card={currentIndex !== null ? pack.cards[currentIndex] : null}
              position={currentIndex !== null ? currentIndex + 1 : 0}
              total={pack.cards.length}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
              onPrevious={goPrevious}
              onNext={goNext}
            />
            <ol className="grid flex-1 grid-cols-5 gap-3 lg:grid-cols-7">
              {pack.cards.map((card, index) => (
                <RevealSlot
                  key={`${pack.itemId}-${index}`}
                  card={card}
                  index={index}
                  isFaceUp={index < revealed}
                  isNext={state.phase === "revealing" && index === revealed}
                  isFocused={currentIndex === index}
                  isInSuspense={suspenseIndex === index}
                  onReveal={revealNext}
                  onFocus={() => setFocusedIndex(index === revealed - 1 ? null : index)}
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
                className="bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-sm font-medium"
              >
                Reveal next
              </button>
              <button
                type="button"
                onClick={() => {
                  setFocusedIndex(null);
                  send({ type: "revealAll" });
                }}
                className="border-line rounded-md border px-3 py-1.5 text-sm"
              >
                Reveal all
              </button>
            </div>
          ) : (
            <div className="border-border-subtle flex flex-wrap items-center gap-4 rounded-lg border p-4">
              <p>
                This pack is worth{" "}
                <strong className="tabular-nums">
                  {Cents.format(Cents.of(packValueCents(pack)))}
                </strong>{" "}
                at market price. Best card: <strong>{bestCard.name}</strong>
                {bestCard.priceCents !== null &&
                  ` (${Cents.format(Cents.of(bestCard.priceCents))})`}
                .
              </p>
              <button
                type="button"
                onClick={() => {
                  setFocusedIndex(null);
                  send({ type: "nextPack" });
                }}
                className="bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-sm font-medium"
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
