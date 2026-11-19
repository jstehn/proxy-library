import { z } from "zod";
import { describeDeckError } from "@/modules/decks";
import type { ActionContext } from "@/server/action";
import { err, ok, type Result } from "@/shared/kernel";
import { rejected, type Outcome } from "./answer";
import { builderDeckFor, type BuilderDeck } from "./builder-deck";

export type { BuilderDeck };

// The deck builder's server side (design doc 14). The browser holds the deck in memory for
// instant statistics and problems (design doc 19); every change goes through the decks module's
// capabilities (ADR 0026), and the fresh deck comes back.

export const DeckIdInput = z.number().int().positive();

export const NOT_YOURS = "That deck isn't yours.";

/** A refused change, with the deck as the server has it so the browser can undo its guess. */
export async function refusal(
  context: ActionContext,
  deckId: number,
  message: string,
): Promise<Outcome<never>> {
  return err(rejected(message, (await loadDeck(context, deckId)) ?? undefined));
}

/** After a change: the failure as a sentence, or the fresh deck. */
export async function afterChange(
  context: ActionContext,
  deckId: number,
  result: Result<unknown, Parameters<typeof describeDeckError>[0]>,
): Promise<Outcome<BuilderDeck>> {
  if (!result.ok) return refusal(context, deckId, describeDeckError(result.error));
  const deck = await loadDeck(context, deckId);
  return deck === null ? err(rejected(NOT_YOURS)) : ok(deck);
}

export async function loadDeck(
  { actor, capabilities }: ActionContext,
  deckId: number,
): Promise<BuilderDeck | null> {
  return builderDeckFor(capabilities, actor.userId, deckId);
}
