"use client";
import { useState, useTransition } from "react";
import type { Board, DeckLine, PrintingFinish, PrintingOption } from "@/modules/decks";
import { Cents } from "@/shared/kernel";
import { choosePrintingAction, printingsAction, type BuilderDeck } from "./actions";

// Choose which printing and finish a deck line uses (design doc 24, section 9).

const BOARD_WORDS: Record<Board, string> = {
  commander: "Commander",
  main: "Deck",
  side: "Sideboard",
};

const FINISH_WORDS: Record<PrintingFinish, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
};

/** Above this many printings, a filter box helps find one. */
const FILTER_FROM = 20;

/** The radio value for "follow my copies". */
const AUTOMATIC = "automatic";

type Props = Readonly<{
  deckId: number;
  /** The selected card's lines in the deck: one per board it's on. */
  lines: readonly DeckLine[];
  onChosen: (deck: BuilderDeck, message: string) => void;
  onError: (message: string) => void;
}>;

export function PrintingPicker({ deckId, lines, onChosen, onError }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [printings, setPrintings] = useState<PrintingOption[] | "loading" | null>(null);
  const [board, setBoard] = useState<Board>(lines[0].board);
  const [filter, setFilter] = useState("");
  const [isSaving, startSaving] = useTransition();
  const line = lines.find((each) => each.board === board) ?? lines[0];
  const oracleId = line.oracleId;

  // What's chosen now, as a radio value: "printing:finish", or AUTOMATIC when not pinned.
  const current =
    line.pinnedPrintingId === null
      ? AUTOMATIC
      : `${line.pinnedPrintingId}:${line.pinnedFinish ?? line.finish}`;
  // The choice being saved, so the radio moves the moment it's clicked.
  const [saving, setSaving] = useState<string | null>(null);
  const checked = saving ?? current;

  function open() {
    setIsOpen(true);
    if (printings !== null) return;
    setPrintings("loading");
    void printingsAction({ deckId, oracleId }).then((found) => setPrintings(found ?? []));
  }

  function choose(value: string) {
    setSaving(value);
    const [printingId, finish] = value.split(":") as [string, PrintingFinish];
    const pinned = value === AUTOMATIC ? null : { printingId, finish };
    startSaving(async () => {
      const result = await choosePrintingAction({ deckId, oracleId, board: line.board, pinned });
      setSaving(null);
      if (!result.ok) {
        onError(result.message);
        return;
      }
      const chosen = Array.isArray(printings)
        ? printings.find((printing) => printing.printingId === printingId)
        : undefined;
      onChosen(
        result.deck,
        pinned === null
          ? `${line.name} follows your copies again.`
          : `${line.name}: ${chosen === undefined ? "printing" : `${chosen.setName} #${chosen.collectorNumber}`}, ${FINISH_WORDS[finish].toLowerCase()}.`,
      );
    });
  }

  if (!isOpen) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500">
          Printing: {line.setCode} #{line.collectorNumber} · {FINISH_WORDS[line.finish]}
          {line.pinnedPrintingId === null ? " (automatic)" : " (chosen)"}
        </span>
        <button
          type="button"
          onClick={open}
          className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700"
        >
          Change printing
        </button>
      </div>
    );
  }

  const words = filter.trim().toLowerCase();
  const shown = Array.isArray(printings)
    ? printings.filter(
        (printing) =>
          words === "" ||
          `${printing.setCode} ${printing.setName} ${printing.collectorNumber} ${printing.labels.join(" ")}`
            .toLowerCase()
            .includes(words),
      )
    : [];
  const owned = shown.filter((printing) => printing.owned > 0);
  const others = shown.filter((printing) => printing.owned === 0);
  const groupName = `printing-${oracleId}-${line.board}`;

  return (
    <fieldset
      className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800"
      aria-busy={isSaving}
    >
      <legend className="px-1 text-sm font-medium">Choose a printing</legend>
      <div className="flex flex-wrap items-center gap-2">
        {lines.length > 1 && (
          <label className="flex items-center gap-1">
            For
            <select
              value={board}
              onChange={(event) => setBoard(event.target.value as Board)}
              className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
            >
              {lines.map((each) => (
                <option key={each.board} value={each.board}>
                  {BOARD_WORDS[each.board]}
                </option>
              ))}
            </select>
          </label>
        )}
        {Array.isArray(printings) && printings.length > FILTER_FROM && (
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by set, number or style"
            aria-label="Filter printings"
            className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          />
        )}
        {isSaving && <span className="text-zinc-500">Saving…</span>}
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="ml-auto rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700"
        >
          Done
        </button>
      </div>

      <label className="flex min-h-10 items-center gap-2 rounded px-1 hover:bg-zinc-100 dark:hover:bg-zinc-900">
        <input
          type="radio"
          name={groupName}
          value={AUTOMATIC}
          checked={checked === AUTOMATIC}
          disabled={isSaving}
          onChange={() => choose(AUTOMATIC)}
        />
        <span>
          <span className="font-medium">Follow my copies (automatic)</span>
          <span className="block text-zinc-500">
            Your most valuable copy, or the standard printing if you own none.
          </span>
        </span>
      </label>

      {printings === "loading" && <p className="text-zinc-500">Loading the printings…</p>}
      {owned.length > 0 && (
        <PrintingGroup
          title="You own"
          printings={owned}
          groupName={groupName}
          checked={checked}
          disabled={isSaving}
          onChoose={choose}
        />
      )}
      {others.length > 0 && (
        <PrintingGroup
          title={owned.length > 0 ? "Other printings" : "Printings"}
          printings={others}
          groupName={groupName}
          checked={checked}
          disabled={isSaving}
          onChoose={choose}
        />
      )}
      {Array.isArray(printings) && shown.length === 0 && (
        <p className="text-zinc-500">No printings match.</p>
      )}
    </fieldset>
  );
}

function PrintingGroup(props: {
  title: string;
  printings: readonly PrintingOption[];
  groupName: string;
  checked: string;
  disabled: boolean;
  onChoose: (value: string) => void;
}) {
  return (
    <section aria-label={props.title} className="flex flex-col gap-1">
      <h4 className="font-medium text-zinc-500">{props.title}</h4>
      <ul className="flex flex-col gap-1">
        {props.printings.map((printing) => (
          <li
            key={printing.printingId}
            className="flex gap-2 rounded border border-zinc-200 p-1.5 dark:border-zinc-800"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served by our image cache */}
            <img
              src={`/api/images/${printing.printingId}/small/front`}
              alt=""
              loading="lazy"
              width={146}
              height={204}
              className="aspect-[146/204] w-12 shrink-0 rounded-[4.5%] bg-zinc-100 dark:bg-zinc-800"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p>
                <span className="font-medium">
                  {printing.setCode} #{printing.collectorNumber}
                </span>{" "}
                · {printing.setName} · {printing.releaseDate.slice(0, 4)}
              </p>
              {printing.labels.length > 0 && (
                <p className="text-zinc-500">{printing.labels.join(" · ")}</p>
              )}
              <div className="flex flex-wrap gap-1">
                {printing.finishes.map((option) => {
                  const value = `${printing.printingId}:${option.finish}`;
                  const isChecked = props.checked === value;
                  return (
                    <label
                      key={option.finish}
                      className={`flex min-h-9 cursor-pointer items-center gap-1 rounded-md border px-2 ${isChecked ? "border-sky-600 bg-sky-50 dark:border-sky-500 dark:bg-sky-950" : "border-zinc-300 dark:border-zinc-700"}`}
                    >
                      <input
                        type="radio"
                        name={props.groupName}
                        value={value}
                        checked={isChecked}
                        disabled={props.disabled}
                        onChange={() => props.onChoose(value)}
                        aria-label={`${printing.setName} #${printing.collectorNumber}, ${FINISH_WORDS[option.finish]}`}
                      />
                      <span>{FINISH_WORDS[option.finish]}</span>
                      {option.priceCents !== null && (
                        <span className="text-zinc-500">
                          {Cents.format(Cents.of(option.priceCents))}
                        </span>
                      )}
                      {option.owned > 0 && (
                        <span className="text-green-700 dark:text-green-400">×{option.owned}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
