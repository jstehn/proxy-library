import type { ActionInputError } from "@/server/action";
import { err, type Result } from "@/shared/kernel";
import type { BuilderDeck } from "./builder-deck";

// What the builder's server actions answer, and how the components read it (design doc 14). Every
// action returns a `Result`: `action()` says the input didn't fit, and a handler that can refuse
// a change says so with `Rejected`. This file holds no server code, so components may import it.

/** The server refused or couldn't do a change: a sentence for the player. */
export type Rejected = Readonly<{
  kind: "Rejected";
  message: string;
  /** For a refused change: the deck as the server has it, so the browser can undo its guess. */
  deck?: BuilderDeck;
}>;

/** What a handler returns when it can refuse. */
export type Outcome<Value> = Result<Value, Rejected>;

/** What the browser gets back from an action whose handler returns `Output`. */
export type Answer<Output> = Result<Output, ActionInputError>;

export function rejected(message: string, deck?: BuilderDeck): Rejected {
  return deck === undefined ? { kind: "Rejected", message } : { kind: "Rejected", message, deck };
}

/**
 * One result from the action's answer: its value, or the sentence to show. An input that didn't
 * fit the schema shows `invalidText`.
 */
export function settle<Value>(answer: Answer<Outcome<Value>>, invalidText: string): Outcome<Value> {
  if (!answer.ok) return err(rejected(invalidText));
  return answer.value;
}

/** A read's value, or `fallback` when the input didn't fit the schema. */
export function valueOr<Value, Fallback>(
  answer: Answer<Value>,
  fallback: Fallback,
): Value | Fallback {
  return answer.ok ? answer.value : fallback;
}

/** What the browser shows when a change's input didn't fit the action's schema. */
export const NOT_UNDERSTOOD_TEXT = "That change wasn't understood.";
