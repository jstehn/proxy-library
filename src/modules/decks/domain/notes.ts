import { err, ok, type Result } from "@/shared/kernel";
import type { NoteInvalid } from "./errors";

// Short per-line notes explaining why a card is in the deck (design doc 41). Pure.

export const MAX_NOTE_LENGTH = 200;

/**
 * Collapses whitespace to single spaces and trims; rejects empty text or text past `MAX_NOTE_LENGTH`.
 * Clearing a note passes `null` at the application boundary (or `""` in UI/MCP).
 */
export function checkNote(raw: string): Result<string, NoteInvalid> {
  const note = raw.trim().replace(/\s+/g, " ");
  if (note.length === 0 || note.length > MAX_NOTE_LENGTH) {
    return err({ kind: "NoteInvalid", maximum: MAX_NOTE_LENGTH });
  }
  return ok(note);
}
