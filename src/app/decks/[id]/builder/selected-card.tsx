"use client";
import { FaceText } from "@/app/_components/card-preview";
import type { PrintingCard } from "@/modules/catalog";
import type { Board } from "@/modules/decks";

// The selected card, large and readable, with what you'd add (design doc 14, section 2.2).

export type Selection = Readonly<{
  oracleId: string;
  printingId: string;
  name: string;
  owned: number;
  /** Copies in this deck per board. */
  inDeck: Readonly<Partial<Record<Board, number>>>;
  otherDecks: number;
  misfit: "color" | "legality" | null;
}>;

const MISFIT_TEXT = {
  color: "Outside your commander's colors",
  legality: "Not legal in this deck's format",
} as const;

export function SelectedCard(props: {
  selection: Selection;
  detail: PrintingCard | null;
  quantity: number;
  onQuantity: (quantity: number) => void;
  onAdd: (board: Board) => void;
  isCommanderDeck: boolean;
  onClose: () => void;
}) {
  const { selection, detail } = props;
  const inDeck = Object.values(selection.inDeck).reduce((sum, value) => sum + (value ?? 0), 0);
  const button =
    "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40 border border-zinc-300 dark:border-zinc-700";

  return (
    <section
      aria-label={`Selected: ${selection.name}`}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/images/${selection.printingId}/normal/front`}
          alt={selection.name}
          width={488}
          height={680}
          className="aspect-[488/680] w-40 shrink-0 rounded-[4.5%] bg-zinc-100 shadow-md sm:w-48 dark:bg-zinc-800"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-semibold">{selection.name}</h3>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Close the selected card"
              className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              ✕
            </button>
          </div>
          {/* The card's printed text, on a dark panel like the card previews. */}
          <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md bg-zinc-900 p-2 text-white">
            {detail === null ? (
              <p className="text-white/60">Loading the card&apos;s text…</p>
            ) : (
              detail.faces.map((face, index) => (
                <FaceText key={index} face={face} isBackFace={index > 0} />
              ))
            )}
          </div>
          <dl className="flex flex-wrap gap-x-3 gap-y-0.5">
            <Fact label="You own" value={String(selection.owned)} />
            <Fact label="In this deck" value={String(inDeck)} />
            {selection.otherDecks > 0 && (
              <Fact label="Other decks using it" value={String(selection.otherDecks)} />
            )}
          </dl>
          {selection.misfit && (
            <p className="text-amber-700 dark:text-amber-400">{MISFIT_TEXT[selection.misfit]}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="How many to add">
          <button
            type="button"
            className="h-8 w-8 rounded-md border border-zinc-300 dark:border-zinc-700"
            onClick={() => props.onQuantity(Math.max(1, props.quantity - 1))}
            aria-label="One fewer to add"
          >
            −
          </button>
          <span className="w-8 text-center tabular-nums" aria-live="polite">
            {props.quantity}
          </span>
          <button
            type="button"
            className="h-8 w-8 rounded-md border border-zinc-300 dark:border-zinc-700"
            onClick={() => props.onQuantity(Math.min(99, props.quantity + 1))}
            aria-label="One more to add"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={() => props.onAdd("main")}
          className={`${button} border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900`}
        >
          Add to deck
        </button>
        <button type="button" onClick={() => props.onAdd("side")} className={button}>
          Sideboard
        </button>
        {props.isCommanderDeck && (
          <button type="button" onClick={() => props.onAdd("commander")} className={button}>
            Make commander
          </button>
        )}
      </div>
      {props.quantity > selection.owned && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          That&apos;s more than you own ({selection.owned}). You can add them; the deck marks it.
        </p>
      )}
    </section>
  );
}

function Fact(props: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="text-zinc-500">{props.label}</dt>
      <dd className="font-medium tabular-nums">{props.value}</dd>
    </div>
  );
}
