"use client";
// One card, shown large: the picture, the printed text, or both. On a phone a toggle chooses
// between them (remembered per device; the picture is the first choice) so a card can be seen
// clearly. From the `md` breakpoint up it keeps the desktop layout: the picture beside the
// heading, text and details. A phone-hidden part stays in the page for screen readers.
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  resolveCardFace,
  toggleCardFace,
  type CardFaceSide,
  type CardStepping,
  type FaceSelection,
} from "./card-art-logic";
import { CardArt } from "./card-art";
import {
  CARD_VIEW_LABELS,
  CARD_VIEW_MODES,
  readCardViewMode,
  visibleParts,
  writeCardViewMode,
  DEFAULT_CARD_VIEW_MODE,
  type CardViewMode,
} from "./card-view-mode";
import { ManaText } from "./mana";

/** What a face needs: structurally the catalog's `CardFace`, which `src/ui` can't import. */
export type CardViewFace = Readonly<{
  name: string;
  manaCost: string | null;
  typeLine: string;
  text: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
}>;

type CardViewProps = {
  printingId: string;
  name: string;
  hasImage?: boolean;
  /** Whether the card has a second face with its own image (double-faced cards). */
  hasBackImage?: boolean;
  /** Controlled face; when omitted, CardView manages flip state per printingId. */
  face?: CardFaceSide;
  onFlip?: () => void;
  /** Carousel navigation on the card art (left/right tap zones + horizontal swipe). */
  stepping?: CardStepping | null;
  /** The printed text, one entry per face; null while it loads. */
  faces: readonly CardViewFace[] | null;
  /** A line under the text, such as the artist. */
  credit?: string | null;
  /** The title row: above the picture on a phone, above the text beside it on desktop. */
  heading?: ReactNode;
  /** Everything under the text (facts, actions). */
  children?: ReactNode;
  /** "responsive": the phone view below `md`, the desktop layout above. "stacked": always the phone view. */
  layout?: "responsive" | "stacked";
  /** "panel": a tinted, scrolling box. "plain": the text as page content. */
  textStyle?: "panel" | "plain";
  /** The picture's width on desktop. */
  desktopImage?: "narrow" | "wide";
};

// The mode lives in one small store, so every card view on the page agrees and a change in
// another tab shows up too.
const listeners = new Set<() => void>();
let currentMode: CardViewMode | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getMode(): CardViewMode {
  currentMode ??= readCardViewMode(storage());
  return currentMode;
}

function setMode(mode: CardViewMode) {
  currentMode = mode;
  writeCardViewMode(storage(), mode);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = () => {
    currentMode = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function useCardViewMode(): readonly [CardViewMode, (mode: CardViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, getMode, () => DEFAULT_CARD_VIEW_MODE);
  return [mode, setMode];
}

export function CardView(props: CardViewProps) {
  const {
    printingId,
    name,
    hasImage = true,
    hasBackImage = false,
    stepping = null,
    faces,
    credit,
    heading,
    children,
  } = props;
  const { layout = "responsive", textStyle = "panel", desktopImage = "narrow" } = props;
  const [mode, chooseMode] = useCardViewMode();
  const [internalFace, setInternalFace] = useState<FaceSelection | null>(null);
  const parts = visibleParts(mode, hasImage);
  const responsive = layout === "responsive";

  const activeFace: CardFaceSide =
    props.face !== undefined
      ? hasBackImage
        ? props.face
        : "front"
      : resolveCardFace(internalFace, printingId, hasBackImage);

  function handleFlip() {
    if (!hasBackImage) return;
    if (props.onFlip) {
      props.onFlip();
    } else {
      setInternalFace((current) => toggleCardFace(current, printingId, hasBackImage));
    }
  }

  // Below `md` (or always, when stacked) the parts are ordered and hidden by the mode; at `md`
  // and up the picture sits left and the rest in a column beside it.
  const root = responsive
    ? `flex flex-col gap-3 md:flex-row ${textStyle === "plain" ? "md:gap-8" : ""}`
    : "flex flex-col gap-3";
  const column = responsive
    ? `contents md:flex md:min-w-0 md:flex-1 md:flex-col ${textStyle === "plain" ? "md:gap-4" : "md:gap-2"}`
    : "contents";
  const imageShown = parts.image ? "" : responsive ? "hidden md:block" : "hidden";
  const textShown = parts.text ? "" : responsive ? "sr-only md:not-sr-only" : "sr-only";
  const imageWidth = desktopImage === "wide" ? "md:w-72" : "md:w-48";
  const imageSide = responsive ? `md:order-first md:mx-0 md:shrink-0 ${imageWidth}` : "";

  return (
    <div className={root}>
      {hasImage && (
        <div className={`order-3 mx-auto w-full max-w-sm self-start ${imageSide} ${imageShown}`}>
          <CardArt
            printingId={printingId}
            name={name}
            hasImage={hasImage}
            hasBackImage={hasBackImage}
            face={activeFace}
            onFlip={handleFlip}
            stepping={stepping}
          />
        </div>
      )}
      <div className={column}>
        {heading && <div className="order-1">{heading}</div>}
        <ViewToggle
          mode={mode}
          onChoose={chooseMode}
          responsive={responsive}
          hasBackImage={hasBackImage}
          activeFace={activeFace}
          onFlip={handleFlip}
          showFlipControl={!parts.image && hasBackImage}
          stepping={!parts.image ? stepping : null}
        />
        <div className={`order-4 ${textShown}`}>
          <CardText
            faces={faces}
            credit={credit}
            textStyle={textStyle}
            desktopImage={desktopImage}
            activeFaceIndex={
              hasBackImage && (faces?.length ?? 0) > 1 ? (activeFace === "back" ? 1 : 0) : null
            }
          />
        </div>
        {children && (
          <div className={`order-5 flex flex-col ${textStyle === "plain" ? "gap-4" : "gap-2"}`}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

const COMPACT_STEP_BUTTON = [
  "border-line text-muted hover:text-foreground",
  "rounded-md border px-2.5 py-1 text-sm disabled:opacity-35",
].join(" ");

function ViewToggle(props: {
  mode: CardViewMode;
  onChoose: (mode: CardViewMode) => void;
  responsive: boolean;
  hasBackImage: boolean;
  activeFace: CardFaceSide;
  onFlip: () => void;
  showFlipControl: boolean;
  stepping: CardStepping | null;
}) {
  const { stepping } = props;
  const showSteps = stepping !== null && stepping.total > 1;
  return (
    <div
      role="group"
      aria-label="What to show of the card"
      className={`order-2 flex flex-wrap items-center gap-1 ${props.responsive ? "md:hidden" : ""}`}
    >
      {CARD_VIEW_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={props.mode === mode}
          onClick={() => props.onChoose(mode)}
          className={`rounded-md border px-3 py-1 text-xs ${
            props.mode === mode
              ? "border-accent bg-accent text-accent-foreground"
              : "border-line text-muted"
          }`}
        >
          {CARD_VIEW_LABELS[mode]}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-1">
        {props.showFlipControl && props.hasBackImage && (
          <button
            type="button"
            aria-pressed={props.activeFace === "back"}
            onClick={props.onFlip}
            className="border-line text-foreground rounded-md border px-3 py-1 text-xs font-medium"
          >
            ↻ {props.activeFace === "back" ? "Front" : "Flip"}
          </button>
        )}
        {showSteps && (
          <>
            <button
              type="button"
              onClick={stepping.onPrevious}
              disabled={stepping.canGoPrevious === false}
              aria-label="Previous card"
              className={COMPACT_STEP_BUTTON}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={stepping.onNext}
              disabled={stepping.canGoNext === false}
              aria-label="Next card"
              className={COMPACT_STEP_BUTTON}
            >
              ›
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CardText(props: {
  faces: readonly CardViewFace[] | null;
  credit?: string | null;
  textStyle: "panel" | "plain";
  desktopImage: "narrow" | "wide";
  activeFaceIndex: number | null;
}) {
  const { faces, credit, textStyle, desktopImage, activeFaceIndex } = props;
  const desktopPanelHeight = desktopImage === "wide" ? "md:max-h-[25rem]" : "md:max-h-56";
  const box =
    textStyle === "panel"
      ? `bg-surface max-h-[50dvh] gap-2 overflow-y-auto rounded-md p-2 text-xs ${desktopPanelHeight}`
      : "gap-4 text-sm";
  return (
    <div className={`flex flex-col ${box}`}>
      {faces === null ? (
        <p className="text-muted">Loading the card&apos;s text…</p>
      ) : (
        faces.map((face, index) => (
          <OracleFace
            key={index}
            face={face}
            faceLabel={activeFaceIndex === null ? null : index === 0 ? "Front" : "Back"}
            isActiveFace={activeFaceIndex === index}
          />
        ))
      )}
      {credit && <p className="text-muted text-xs">{credit}</p>}
    </div>
  );
}

/** One face's printed text: name and cost, type line, rules text, stats. */
function OracleFace(props: {
  face: CardViewFace;
  faceLabel: string | null;
  isActiveFace: boolean;
}) {
  const { face, faceLabel, isActiveFace } = props;
  const stats =
    face.power !== null && face.toughness !== null
      ? `${face.power}/${face.toughness}`
      : face.loyalty !== null
        ? `Loyalty ${face.loyalty}`
        : face.defense !== null
          ? `Defense ${face.defense}`
          : null;
  return (
    <section
      className={`flex flex-col gap-1 ${
        faceLabel !== null
          ? isActiveFace
            ? "border-accent border-l-2 pl-2"
            : "border-border-subtle border-l-2 pl-2 opacity-75"
          : ""
      }`}
    >
      {faceLabel !== null && (
        <span className="text-muted text-[10px] font-semibold tracking-wide uppercase">
          {faceLabel}
          {isActiveFace ? " · showing" : ""}
        </span>
      )}
      <p className="flex justify-between gap-2 font-medium">
        <span>{face.name}</span>
        {face.manaCost && (
          <span className="shrink-0">
            <ManaText text={face.manaCost} />
          </span>
        )}
      </p>
      <p className="text-muted italic">{face.typeLine}</p>
      {face.text
        .split("\n")
        .filter((paragraph) => paragraph.trim() !== "")
        .map((paragraph, index) => (
          <p key={index}>
            <ManaText text={paragraph} />
          </p>
        ))}
      {stats && <p className="self-end font-semibold tabular-nums">{stats}</p>}
    </section>
  );
}
