"use client";
import { useEffect, useState } from "react";
import type { CastReport } from "@/modules/decks";
import { castCurveAction } from "./actions";
import { castBars, castCaption, castMedian } from "./cast-bars";
import { Eyebrow } from "@/ui/eyebrow";

// The chance of casting a card by each turn (the draw_sample tool's measurement): bars for turns
// 1 to 10 and the median turn. The commander's loads when the panel opens; a card's, when asked.

type Answer = CastReport | "loading" | string | null;

/** The report, or a sentence saying why there is none. */
async function fetchAnswer(deckId: number, card: string): Promise<CastReport | string> {
  const result = await castCurveAction({ deckId, card });
  if (!result.ok) return "That wasn't understood.";
  return result.value.ok ? result.value.value : result.value.error.message;
}

export function CastCurve(props: {
  deckId: number;
  /** A card name, or "commander". */
  card: string;
  /** Load right away (the commander) instead of waiting for the button. */
  auto?: boolean;
}) {
  const { deckId, card: cardName, auto } = props;
  const [answer, setAnswer] = useState<Answer>(auto ? "loading" : null);

  function load() {
    setAnswer("loading");
    void fetchAnswer(deckId, cardName).then(setAnswer);
  }

  // Edits to the deck don't rerun it; the "Run again" button does.
  useEffect(() => {
    if (auto) void fetchAnswer(deckId, cardName).then(setAnswer);
  }, [auto, deckId, cardName]);

  if (answer === null) {
    return (
      <button type="button" onClick={load} className="self-start text-xs underline">
        When can I cast this?
      </button>
    );
  }
  if (answer === "loading") return <p className="text-muted text-xs">Simulating games…</p>;
  if (typeof answer === "string") return <p className="text-warning-text text-xs">{answer}</p>;

  const [card] = answer.cards;
  const bars = castBars(card);
  return (
    <div className="flex flex-col gap-1">
      <Eyebrow as="h3">{castCaption(answer)}</Eyebrow>
      <div
        className="flex h-20 items-end gap-1"
        role="img"
        aria-label={`Chance of casting ${card.card} by turn: ${bars.map((bar) => `turn ${bar.turn} ${bar.pct}%`).join(", ")}`}
      >
        {bars.map((bar) => (
          <div key={bar.turn} className="flex flex-1 flex-col items-center justify-end gap-0.5">
            <span className="text-[10px] tabular-nums">{bar.pct}</span>
            <div
              className="w-full rounded-t bg-sky-600 dark:bg-sky-400"
              style={{ height: `${(bar.pct / 100) * 56}px` }}
            />
          </div>
        ))}
      </div>
      <div className="text-muted flex gap-1 text-[10px]">
        {bars.map((bar) => (
          <span key={bar.turn} className="flex-1 text-center">
            {bar.turn}
          </span>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 text-xs">
        <span className="font-medium">{castMedian(card, bars.length)}</span>
        {card.misses !== "" && <span className="text-muted">Misses: {card.misses}</span>}
        <button type="button" onClick={load} className="text-muted underline">
          Run again
        </button>
      </p>
    </div>
  );
}
