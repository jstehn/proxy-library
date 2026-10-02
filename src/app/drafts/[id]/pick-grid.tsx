"use client";
import { useState, useTransition } from "react";
import type { PrintingCard } from "@/modules/catalog";
import { EnlargedCard } from "../../_components/card-preview";
import { pickAction } from "../actions";

// The pack in front of you. Tap (or click) a card to see it large, then "Pick"; a double click
// picks at once. The pick is a server action; the page then shows the next pack.

export type PackCardView = Readonly<{ slot: number; finish: string; printing: PrintingCard }>;

export function PickGrid(props: {
  draftId: number;
  packNumber: number;
  cards: readonly PackCardView[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPicking, startPicking] = useTransition();
  const chosen = props.cards.find((card) => card.slot === selected) ?? null;

  function pick(slot: number) {
    if (isPicking) return;
    setError(null);
    startPicking(async () => {
      const result = await pickAction({
        draftId: props.draftId,
        packNumber: props.packNumber,
        slot,
      });
      if (result.error !== null) setError(result.error);
      setSelected(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-10 flex-wrap items-center gap-3">
        {chosen === null ? (
          <p className="text-sm text-zinc-500">
            Tap a card to look at it, then pick it. Double-click picks straight away.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => pick(chosen.slot)}
              disabled={isPicking}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {isPicking ? "Picking…" : `Pick ${chosen.printing.name}`}
            </button>
            <button type="button" onClick={() => setSelected(null)} className="text-sm underline">
              Cancel
            </button>
          </>
        )}
        {error !== null && <span className="text-sm text-red-700 dark:text-red-300">{error}</span>}
      </div>

      {/* On phones a card that opens over the grid would hide it: show the chosen one here. */}
      {chosen !== null && chosen.printing.hasImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/images/${chosen.printing.id}/normal/front`}
          alt={chosen.printing.name}
          width={488}
          height={680}
          className="mx-auto aspect-[488/680] w-3/4 max-w-xs rounded-[4.5%] sm:hidden"
        />
      )}

      <ul
        className={`grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7 ${isPicking ? "opacity-60" : ""}`}
        aria-label="Your pack"
      >
        {props.cards.map((card) => {
          const isSelected = card.slot === selected;
          return (
            <li key={card.slot} className="relative">
              <button
                type="button"
                onClick={() => setSelected(isSelected ? null : card.slot)}
                onDoubleClick={() => pick(card.slot)}
                aria-pressed={isSelected}
                aria-label={`${card.printing.name}${card.finish === "nonfoil" ? "" : ` (${card.finish})`}`}
                className={`relative block w-full rounded-[4.5%] transition ${
                  isSelected
                    ? "ring-4 ring-sky-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950"
                    : "hover:-translate-y-0.5"
                }`}
              >
                {card.printing.hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/images/${card.printing.id}/normal/front`}
                    alt=""
                    width={146}
                    height={204}
                    className="aspect-[146/204] w-full rounded-[4.5%] bg-zinc-100 dark:bg-zinc-800"
                  />
                ) : (
                  <span className="flex aspect-[146/204] w-full items-center justify-center rounded-[4.5%] bg-zinc-100 p-2 text-center text-xs dark:bg-zinc-800">
                    {card.printing.name}
                  </span>
                )}
                {card.finish !== "nonfoil" && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-[4.5%] bg-gradient-to-br from-fuchsia-400/35 via-transparent to-cyan-300/40"
                  />
                )}
              </button>
              {isSelected && (
                <div className="hidden sm:block">
                  <EnlargedCard printing={card.printing} align={alignFor(card.slot, props.cards)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Cards near the left or right edge of the row open toward the middle. */
function alignFor(slot: number, cards: readonly PackCardView[]): "left" | "center" | "right" {
  const index = cards.findIndex((card) => card.slot === slot);
  const column = index % 7;
  if (column === 0) return "left";
  if (column === 6) return "right";
  return "center";
}
