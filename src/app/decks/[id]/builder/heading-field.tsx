"use client";
import { useState } from "react";
import type { DeckLine } from "@/modules/decks";
import { MAX_HEADING_LENGTH } from "@/modules/decks/client";

// The selected card's heading (design doc 34): type one, pick one the deck has, or clear it.
// Only main-deck cards have one shown; the commander, sideboard and maybeboard are boards.

export function HeadingField(props: {
  /** The selected card's main-deck line. */
  line: DeckLine;
  /** The deck's headings in order, offered as you type. */
  headings: readonly string[];
  busy: boolean;
  onSave: (line: DeckLine, heading: string | null) => void;
}) {
  const { line } = props;
  const [text, setText] = useState(line.heading ?? "");
  const changed = text.trim() !== (line.heading ?? "");
  const listId = `headings-${line.oracleId}`;
  const button =
    "rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-zinc-700";

  return (
    <form
      aria-label={`Heading for ${line.name}`}
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) props.onSave(line, text.trim() === "" ? null : text.trim());
      }}
    >
      <label htmlFor={`${listId}-input`} className="text-xs text-zinc-500">
        Heading
      </label>
      <input
        id={`${listId}-input`}
        list={listId}
        value={text}
        maxLength={MAX_HEADING_LENGTH}
        placeholder="e.g. Ramp"
        onChange={(event) => setText(event.target.value)}
        className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
      />
      <datalist id={listId}>
        {props.headings.map((heading) => (
          <option key={heading} value={heading} />
        ))}
      </datalist>
      <button type="submit" disabled={props.busy || !changed} className={button}>
        Save
      </button>
      {line.heading !== null && (
        <button
          type="button"
          disabled={props.busy}
          onClick={() => {
            setText("");
            props.onSave(line, null);
          }}
          className={button}
        >
          None
        </button>
      )}
    </form>
  );
}
