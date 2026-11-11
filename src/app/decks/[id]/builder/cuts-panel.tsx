"use client";
import { useMemo } from "react";
import type { Bracket, Board, DeckLine, Format } from "@/modules/decks";
import { rankCuts } from "@/modules/decks/client";
import { cutReasonText } from "../../labels";

// Cards to cut (design doc 32, section 9): the deck's weakest main-deck cards, weakest first,
// with the reasons for each and a button to move it to the maybeboard. Worked out in the
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
      aria-label="Cards to cut"
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Cards to cut</h2>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close cards to cut"
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ✕
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        The weakest cards first, judged on the deck&apos;s themes, its role counts, its curve and
        your target bracket. Lands and commanders aren&apos;t listed.
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
