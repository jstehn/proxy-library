"use client";
import { useMemo } from "react";
import type { Bracket, Board, DeckLine, Format } from "@/modules/decks";
import { rankCuts } from "@/modules/decks/client";
import { cutReasonText } from "../../labels";

// Possible cuts (design doc 32, section 9): the main-deck cards that score lowest on simple
// checks, with the reasons for each and a button to move it to the maybeboard. Ideas to weigh,
// not verdicts: the checks read rules text with fixed patterns. Worked out in the
// browser from the deck in hand, like the problems, so it follows every edit.

/** How many cut candidates the panel shows. */
export const CUTS_SHOWN = 10;

export function CutsPanel(props: {
  lines: readonly DeckLine[];
  format: Format;
  targetBracket: Bracket | null;
  onMove: (line: DeckLine, to: Board) => void;
  onSelect: (line: DeckLine) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const { lines, format, targetBracket } = props;
  const cuts = useMemo(
    () => rankCuts(lines, { format, targetBracket }).slice(0, CUTS_SHOWN),
    [lines, format, targetBracket],
  );
  const lineOf = (oracleId: string) =>
    lines.find((line) => line.oracleId === oracleId && line.board === "main");

  return (
    <section
      aria-label="Possible cuts"
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Possible cuts</h2>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close possible cuts"
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ✕
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Ideas to consider, not rules: the cards that score lowest on a few simple checks (the themes
        the app found, role counts, the curve and your target bracket). The checks read rules text,
        so they miss combos, synergies they have no rule for and how you play the deck. Lands and
        commanders aren&apos;t listed.
      </p>
      {cuts.length === 0 ? (
        <p className="text-zinc-500">No cards to judge yet: add some spells to the main deck.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {cuts.map((cut) => {
            const line = lineOf(cut.oracleId);
            return (
              <li key={cut.oracleId} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => line && props.onSelect(line)}
                    className="text-left font-medium underline-offset-2 hover:underline"
                  >
                    {cut.name}
                  </button>
                  <ul className="text-xs text-zinc-600 dark:text-zinc-400">
                    {cut.reasons.map((reason, index) => (
                      <li key={index}>{cutReasonText(reason)}</li>
                    ))}
                  </ul>
                </div>
                {line !== undefined && (
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.onMove(line, "maybe")}
                    aria-label={`Move ${cut.name} to the maybeboard`}
                    className="shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700"
                  >
                    To maybeboard
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
