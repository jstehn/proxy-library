"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { MatchedLine, PrintingChoice, UnmatchedReason } from "@/modules/real-collection";
import { assertNever, Cents } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import {
  applyImportAction,
  previewImportAction,
  type ApplyAnswer,
  type PreviewAnswer,
} from "../actions";

// Importing real cards (design doc 16, sections 4 to 7, and 15.2): paste or upload, see what
// each line matched, change any line's printing, then import exactly that.

const field =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
const primary =
  "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";
const secondary =
  "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700";
/** Lines shown with a printing menu; the rest import as matched (a long file stays quick). */
const SHOWN_LINES = 300;
const MAX_FILE_BYTES = 5_000_000;

const FORMAT_NAMES = {
  list: "a pasted list",
  moxfield: "a Moxfield collection file",
  manabox: "a ManaBox file",
  ours: "our own export",
} as const;

function reasonText(reason: UnmatchedReason): string {
  switch (reason.kind) {
    case "NoSuchCard":
      return "no card has that name";
    case "NoSuchPrinting":
      return "the card exists, but not with that set and number";
    case "FinishNotAvailable":
      return `not made in that finish (only ${reason.finishes.join(", ")})`;
    default:
      return assertNever(reason);
  }
}

/** "Bloomburrow #2 (Borderless) · $1.20" for a printing menu. */
function choiceLabel(choice: PrintingChoice, finish: "nonfoil" | "foil" | "etched"): string {
  const price = choice.prices[finish];
  const variant = choice.variantLabel === "" ? "" : ` (${choice.variantLabel})`;
  const priceText = price === undefined ? "" : ` · ${Cents.format(Cents.of(price))}`;
  return `${choice.setName} #${choice.collectorNumber}${variant}${priceText}`;
}

export function RealImporter() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [answer, setAnswer] = useState<PreviewAnswer | null>(null);
  /** Printings changed by hand in the preview, by line index. */
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [makeDeck, setMakeDeck] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [result, setResult] = useState<ApplyAnswer | null>(null);
  const [isWorking, startWork] = useTransition();

  function preview(nextText = text, nextMode = mode) {
    startWork(async () => {
      setResult(null);
      setChosen({});
      setAnswer(await previewImportAction({ text: nextText, mode: nextMode }));
    });
  }

  async function chooseFile(file: File | undefined) {
    if (file === undefined) return;
    if (file.size > MAX_FILE_BYTES) {
      setAnswer({ ok: false, message: "That file is over 5 MB: too big to import at once." });
      return;
    }
    const contents = await file.text();
    setText(contents);
    setFileName(file.name);
    preview(contents);
  }

  const lines = answer?.ok ? answer.preview.lines : [];
  const matched = lines.filter(
    (line): line is Extract<MatchedLine, { kind: "Matched" }> => line.kind === "Matched",
  );
  const unmatched = lines.filter(
    (line): line is Extract<MatchedLine, { kind: "Unmatched" }> => line.kind === "Unmatched",
  );
  const isList = answer?.ok === true && answer.preview.format === "list";

  function importIt() {
    if (!answer?.ok) return;
    const confirmed = matched.map((line) => ({
      printingId: chosen[line.line.index] ?? line.printingId,
      finish: line.line.finish,
      quantity: line.line.quantity,
      board: line.line.board,
    }));
    startWork(async () => {
      const applied = await applyImportAction({
        lines: confirmed,
        mode: answer.preview.mode,
        version: answer.preview.version,
        deckName: isList && makeDeck ? deckName : null,
      });
      setResult(applied);
      // Rule 6: the collection changed in another tab, so show the new preview.
      if (!applied.ok && applied.changed) preview();
    });
  }

  const plan = answer?.ok ? answer.preview.plan : null;
  const copies = matched.reduce((total, line) => total + line.line.quantity, 0);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="What to import" className="flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setFileName(null);
            setAnswer(null);
            setResult(null);
          }}
          rows={10}
          aria-label="Cards to import"
          placeholder={"4 Lightning Bolt\n1 Sol Ring (C21) 263\n1 Beza, the Bounding Spring *F*"}
          className={`${field} font-mono`}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            Or a file:
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={(event) => void chooseFile(event.target.files?.[0])}
              className="max-w-full text-sm"
            />
          </label>
          {fileName !== null && <span className="text-muted">{fileName}</span>}
        </div>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">How to import</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={mode === "add"}
              onChange={() => {
                setMode("add");
                if (answer !== null) preview(text, "add");
              }}
            />
            Add to my real collection
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={mode === "replace"}
              onChange={() => {
                setMode("replace");
                if (answer !== null) preview(text, "replace");
              }}
            />
            Replace it with exactly this
          </label>
        </fieldset>
        <div>
          <button
            type="button"
            className={secondary}
            disabled={isWorking || text.trim() === ""}
            onClick={() => preview()}
          >
            {isWorking ? "Reading…" : "Preview"}
          </button>
        </div>
      </section>

      {answer !== null && !answer.ok && <Alert tone="error">{answer.message}</Alert>}

      {answer?.ok && plan !== null && (
        <section aria-label="Preview" className="flex flex-col gap-4">
          <p className="text-sm">
            Read as {FORMAT_NAMES[answer.preview.format]}: <strong>{matched.length}</strong> lines
            matched ({copies} cards)
            {unmatched.length + answer.preview.unreadable.length > 0 &&
              `, ${unmatched.length + answer.preview.unreadable.length} skipped`}
            . Importing makes {plan.added.length} new rows, changes {plan.changed.length}
            {answer.preview.mode === "replace" && (
              <>
                {" "}
                and <strong>removes {plan.removed.length}</strong> (cards not in this import)
              </>
            )}
            .
          </p>

          {matched.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted text-left text-xs">
                  <tr>
                    <th className="py-1 pr-2 font-normal">Copies</th>
                    <th className="py-1 pr-2 font-normal">Card</th>
                    <th className="py-1 font-normal">Printing</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.slice(0, SHOWN_LINES).map((line) => {
                    const options = (answer.printings[line.oracleId] ?? []).filter((choice) =>
                      choice.finishes.includes(line.line.finish),
                    );
                    return (
                      <tr
                        key={line.line.index}
                        className="border-t border-zinc-200 dark:border-zinc-800"
                      >
                        <td className="py-1 pr-2 tabular-nums">{line.line.quantity}</td>
                        <td className="py-1 pr-2">
                          {line.line.name}
                          {line.line.finish !== "nonfoil" && (
                            <span className="text-muted text-xs"> ({line.line.finish})</span>
                          )}
                        </td>
                        <td className="py-1">
                          <select
                            value={chosen[line.line.index] ?? line.printingId}
                            onChange={(event) =>
                              setChosen((current) => ({
                                ...current,
                                [line.line.index]: event.target.value,
                              }))
                            }
                            aria-label={`Printing of ${line.line.name}`}
                            className={`${field} w-full max-w-xs`}
                          >
                            {options.map((choice) => (
                              <option key={choice.printingId} value={choice.printingId}>
                                {choiceLabel(choice, line.line.finish)}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {matched.length > SHOWN_LINES && (
                <p className="text-muted mt-2 text-xs">
                  …and {matched.length - SHOWN_LINES} more lines, imported as matched. Change their
                  printing later on each card&apos;s page.
                </p>
              )}
            </div>
          )}

          {unmatched.length + answer.preview.unreadable.length > 0 && (
            <details
              open={unmatched.length + answer.preview.unreadable.length <= 20}
              className="text-sm"
            >
              <summary className="cursor-pointer font-medium">
                Skipped ({unmatched.length + answer.preview.unreadable.length})
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5 text-zinc-600 dark:text-zinc-400">
                {unmatched.map((line) => (
                  <li key={line.line.index}>
                    {line.line.quantity} {line.line.name}
                    {line.line.setCode &&
                      ` (${line.line.setCode}${line.line.collectorNumber ? ` ${line.line.collectorNumber}` : ""})`}
                    : {reasonText(line.reason)}
                  </li>
                ))}
                {answer.preview.unreadable.map((raw, index) => (
                  <li key={`unreadable-${index}`}>
                    <code>{raw}</code>: couldn&apos;t read this line
                  </li>
                ))}
              </ul>
            </details>
          )}

          {isList && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={makeDeck}
                  onChange={(event) => setMakeDeck(event.target.checked)}
                />
                Also make a deck from this list
              </label>
              {makeDeck && (
                <input
                  value={deckName}
                  onChange={(event) => setDeckName(event.target.value)}
                  maxLength={60}
                  placeholder="Deck name"
                  aria-label="Deck name"
                  className={field}
                />
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={primary}
              disabled={
                isWorking || matched.length === 0 || (isList && makeDeck && deckName.trim() === "")
              }
              onClick={importIt}
            >
              {isWorking ? "Importing…" : "Import"}
            </button>
            <span className="text-muted text-xs">Nothing is saved until you press Import.</span>
          </div>
        </section>
      )}

      {result !== null && (
        <Alert tone={result.ok ? "success" : "error"}>
          {result.message}{" "}
          {result.ok && (
            <Link href="/collection/real" className="underline">
              See your real collection
            </Link>
          )}
          {result.ok && result.deck !== null && (
            <>
              {" · "}
              <Link href={`/decks/${result.deck.id}`} className="underline">
                Open {result.deck.name}
              </Link>
            </>
          )}
        </Alert>
      )}
    </div>
  );
}
