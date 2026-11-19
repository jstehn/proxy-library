import { z } from "zod";
import { describeDeckError } from "@/modules/decks";
import { action } from "@/server/action-instance";
import type { ActionContext } from "@/server/action";
import { type Result } from "@/shared/kernel";
import { builderDeckFor, type BuilderDeck } from "./builder-deck";

export type { BuilderDeck };

// The deck builder's server side (design doc 14). The browser holds the deck in memory for
// instant statistics and problems (design doc 19); every change goes through the decks module's
/**
 * `action()` with the answer the browser has always got: an input that doesn't fit the schema
 * returns `ifInvalid` instead of a `Result`.
 */
export function builderAction<Schema extends z.ZodType, Output>(
  schema: Schema,
  ifInvalid: NoInfer<Output>,
  handler: (context: ActionContext, input: z.output<Schema>) => Promise<Output>,
): (input: z.input<Schema>) => Promise<Output> {
  const run = action(schema, handler);
  return async function runForBrowser(input) {
    const result = await run(input);
    return result.ok ? result.value : ifInvalid;
  };
}

export const DeckIdInput = z.number().int().positive();

export type QuantityResult = { ok: true; deck: BuilderDeck } | { ok: false; message: string };

export const fail = (message: string) => ({ ok: false, message }) as const;
export const NOT_YOURS = "That deck isn't yours.";
export const NOT_UNDERSTOOD = fail("That change wasn't understood.");

/** After a change: the failure as a sentence, or the fresh deck. */
export async function afterChange(
  context: ActionContext,
  deckId: number,
  result: Result<unknown, Parameters<typeof describeDeckError>[0]>,
): Promise<QuantityResult> {
  if (!result.ok) return fail(describeDeckError(result.error));
  const deck = await loadDeck(context, deckId);
  return deck === null ? fail(NOT_YOURS) : { ok: true, deck };
}

export async function loadDeck(
  { actor, capabilities }: ActionContext,
  deckId: number,
): Promise<BuilderDeck | null> {
  return builderDeckFor(capabilities, actor.userId, deckId);
}
