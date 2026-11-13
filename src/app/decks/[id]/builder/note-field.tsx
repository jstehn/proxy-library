"use client";
import { useState } from "react";
import type { Board, DeckLine } from "@/modules/decks";
import { checkNote, MAX_NOTE_LENGTH } from "@/modules/decks/client";

const BOARD_LABELS: Readonly<Record<Board, string>> = {
  main: "Main",
  side: "Sideboard",
  maybe: "Maybeboard",
  commander: "Commander",
};

/**
 * The control for why a card is in this deck: a short note stored per entry (design doc 41).
 */
export function NoteField(props: {
  line: DeckLine;
  showBoard?: boolean;
  busy: boolean;
  onSave: (line: DeckLine, note: string | null) => void;
}) {
  const { line } = props;
  const current = line.note ?? "";
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const inputId = `note-${line.board}-${line.oracleId}`;
  const errorId = `${inputId}-error`;
  const trimmed = draft.trim();
  const nextNote = trimmed === "" ? null : trimmed;
  const unchanged = nextNote === line.note;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (nextNote !== null) {
      const checked = checkNote(nextNote);
      if (!checked.ok) {
        setError(`Notes can have at most ${MAX_NOTE_LENGTH} characters.`);
        return;
      }
    }
    setError(null);
    props.onSave(line, nextNote);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-muted text-xs font-medium">
          {props.showBoard ? `Note (${BOARD_LABELS[line.board]})` : "Note"}
        </label>
        <span className="text-[11px] text-zinc-400 tabular-nums">
          {draft.length}/{MAX_NOTE_LENGTH}
        </span>
      </div>
      <div className="flex gap-1.5">
        <input
          id={inputId}
          name="note"
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error !== null) setError(null);
          }}
          placeholder="Why is this card here?"
          maxLength={MAX_NOTE_LENGTH}
          aria-invalid={error !== null ? "true" : "false"}
          aria-describedby={error !== null ? errorId : undefined}
          disabled={props.busy}
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={props.busy || unchanged}
          className="rounded border border-zinc-300 px-2.5 py-1 text-xs disabled:opacity-40 dark:border-zinc-700"
        >
          Save
        </button>
        {(line.note !== null || trimmed !== "") && (
          <button
            type="button"
            disabled={props.busy}
            onClick={() => {
              setDraft("");
              setError(null);
              if (line.note !== null) props.onSave(line, null);
            }}
            className="rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-zinc-700"
          >
            Clear
          </button>
        )}
      </div>
      {error !== null && (
        <p id={errorId} role="status" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
