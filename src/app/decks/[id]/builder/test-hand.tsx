"use client";
import { useEffect, useRef, useState } from "react";
import { NamePreview } from "@/app/_components/card-preview";
import type { PrintingCard } from "@/modules/catalog";
import type { DeckLine, Format } from "@/modules/decks";
import {
  deckOdds,
  library,
  nextHand,
  startHand,
  type LibraryCard,
  type TestHand,
} from "@/modules/decks/client";
import { seededRng } from "@/shared/kernel";

// The test hand (design doc 19, section 5.2): deal an opening hand from the deck, mulligan, draw,
// and see the exact odds of drawing lands and roles. The rules live in the pure reducer
// `nextHand`; this component only keeps its state and shows it. Nothing is saved.

export function TestHandPanel(props: {
  lines: readonly DeckLine[];
  format: Format;
  /** From the server, so shuffles need no Math.random (ADR 0008's implementation note). */
  seed: string;
  cards: Readonly<Record<string, PrintingCard>>;
  onClose: () => void;
}) {
  const cards = library(props.lines);
  // Each shuffle gets its own seed: the page's seed and a running count.
  const shuffles = useRef(0);
  const nextRng = () => seededRng(`${props.seed}:${shuffles.current++}`);
  const [freeMulligan, setFreeMulligan] = useState(props.format === "commander");
  const [onTheDraw, setOnTheDraw] = useState(false);
  const [hand, setHand] = useState<TestHand>(() =>
    startHand(cards, seededRng(`${props.seed}:start`), props.format === "commander"),
  );

  /** A fresh hand from the deck as it is now (cards may have changed since the last one). */
  function newHand(free = freeMulligan) {
    setHand(startHand(cards, nextRng(), free));
  }
  function mulligan() {
    setHand((current) => nextHand(current, { kind: "mulligan", rng: nextRng() }));
  }
  function draw() {
    setHand((current) => nextHand(current, { kind: "draw" }));
  }
  function bottom(card: LibraryCard) {
    setHand((current) => nextHand(current, { kind: "bottom", key: card.key }));
  }

  // N, M and D while the panel is open (not while typing in a box).
  // The listener reads the latest actions through a ref, updated after each render.
  const keys = useRef({ newHand, mulligan, draw });
  useEffect(() => {
    keys.current = { newHand, mulligan, draw };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select") || event.ctrlKey || event.metaKey) return;
      const action = { n: keys.current.newHand, m: keys.current.mulligan, d: keys.current.draw }[
        event.key.toLowerCase()
      ];
      if (action === undefined) return;
      event.preventDefault();
      action();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const odds = deckOdds(cards, onTheDraw);
  const canMulligan = hand.turn === 0 && hand.toBottom === 0;
  const button =
    "rounded-md border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700";

  return (
    <section
      aria-label="Test hand"
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Test hand</h2>
        <p className="text-xs text-zinc-500">
          {hand.mulligans === 0
            ? "No mulligans"
            : `Mulligans: ${hand.mulligans}${hand.freeMulligan ? " (first free)" : ""}`}
          {" · "}
          {hand.turn === 0 ? "opening hand" : `turn ${hand.turn}`}
          {" · "}
          {hand.library.length} in library
        </p>
        <button type="button" onClick={props.onClose} className="text-xs underline">
          Close
        </button>
      </div>

      {cards.length === 0 ? (
        <p className="text-zinc-500">Add cards to the main deck to draw a hand.</p>
      ) : (
        <>
          {hand.toBottom > 0 && (
            <p role="status" className="text-amber-700 dark:text-amber-400">
              Choose {hand.toBottom} {hand.toBottom === 1 ? "card" : "cards"} to put on the bottom.
            </p>
          )}
          <ul aria-label="Cards in hand" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {hand.hand.map((card) => (
              <li key={card.key} className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={hand.toBottom === 0}
                  onClick={() => bottom(card)}
                  aria-label={hand.toBottom > 0 ? `Put ${card.name} on the bottom` : card.name}
                  className="block w-full enabled:cursor-pointer enabled:hover:opacity-70"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/images/${card.printingId}/small/front`}
                    alt=""
                    className="aspect-[146/204] w-full rounded-[4.5%] bg-zinc-100 dark:bg-zinc-800"
                  />
                </button>
                <NamePreview
                  printing={props.cards[card.printingId]}
                  name={card.name}
                  className="truncate text-[11px]"
                />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button} onClick={() => newHand()}>
              New hand
            </button>
            <button type="button" className={button} disabled={!canMulligan} onClick={mulligan}>
              Mulligan
            </button>
            <button
              type="button"
              className={button}
              disabled={hand.toBottom > 0 || hand.library.length === 0}
              onClick={draw}
            >
              Draw
            </button>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={freeMulligan}
                onChange={(event) => {
                  setFreeMulligan(event.target.checked);
                  newHand(event.target.checked);
                }}
              />
              First mulligan free
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                Odds ({cards.length}-card library)
              </h3>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={onTheDraw}
                  onChange={(event) => setOnTheDraw(event.target.checked)}
                />
                On the draw
              </label>
            </div>
            <dl aria-label="Odds" className="flex flex-col">
              {odds.map((row) => (
                <div key={row.label} className="flex justify-between gap-2">
                  <dt className="text-zinc-500">{row.label}</dt>
                  <dd className="tabular-nums">{Math.round(row.chance * 100)}%</dd>
                </div>
              ))}
            </dl>
            <p className="text-[10px] text-zinc-500">
              Exact odds for drawing without replacement. &quot;By turn N&quot; counts the opening
              hand and each draw step, {onTheDraw ? "with" : "without"} the extra card for going
              second.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
