"use client";
import { useState } from "react";
import type { DeckLine } from "@/modules/decks";
import { MAX_ROLE_LENGTH, tidyRole } from "@/modules/decks/client";

export type LineDetails = Readonly<{ role?: string | null; pinned?: boolean }>;

/**
 * A card's one-line job in this deck and its pin (design doc 61): the role shows in the deck list
 * and to the tools, and a pinned card is never suggested as a cut or replacement.
 */
export function RoleField(props: {
  line: DeckLine;
  busy: boolean;
  onSave: (line: DeckLine, details: LineDetails) => void;
}) {
  const { line } = props;
  const current = line.role ?? null;
  const [draft, setDraft] = useState(current ?? "");
  const inputId = `role-${line.board}-${line.oracleId}`;
  const nextRole = tidyRole(draft);
  const unchanged = nextRole === current;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    props.onSave(line, { role: nextRole });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-muted text-xs font-medium">
          Role in this deck
        </label>
        <span className="text-muted text-[11px] tabular-nums">
          {draft.length}/{MAX_ROLE_LENGTH}
        </span>
      </div>
      <div className="flex gap-1.5">
        <input
          id={inputId}
          name="role"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="e.g. Free sac outlet for Avacyn"
          maxLength={MAX_ROLE_LENGTH}
          disabled={props.busy}
          className="border-line min-w-0 flex-1 rounded border bg-transparent px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={props.busy || unchanged}
          className="border-line rounded border px-2.5 py-1 text-xs disabled:opacity-40"
        >
          Save
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={line.pinned === true}
          disabled={props.busy}
          onChange={(event) => props.onSave(line, { pinned: event.target.checked })}
        />
        <span>
          Pinned <span className="text-muted">(never suggested as a cut or replacement)</span>
        </span>
      </label>
    </form>
  );
}
