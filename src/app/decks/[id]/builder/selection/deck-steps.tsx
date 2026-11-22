"use client";

// Previous and Next beside the selected card's close button: on a phone you can look through the
// deck card by card without closing the card and tapping the next name.

/** Where the selected card is in the deck list, and how to move to its neighbours. */
export type DeckStepping = Readonly<{
  /** 1 for the first card of the deck list. */
  position: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}>;

const STEP_BUTTON =
  "border-line text-muted hover:text-foreground flex h-11 w-11 items-center justify-center rounded-md border text-lg";

export function DeckSteps(props: { stepping: DeckStepping }) {
  const { stepping } = props;
  return (
    <div role="group" aria-label="Step through the deck" className="flex items-center gap-1">
      <button
        type="button"
        onClick={stepping.onPrevious}
        aria-label="Previous card in the deck"
        className={STEP_BUTTON}
      >
        ‹
      </button>
      <span className="text-muted min-w-12 text-center text-xs tabular-nums">
        {stepping.position} / {stepping.total}
      </span>
      <button
        type="button"
        onClick={stepping.onNext}
        aria-label="Next card in the deck"
        className={STEP_BUTTON}
      >
        ›
      </button>
    </div>
  );
}
