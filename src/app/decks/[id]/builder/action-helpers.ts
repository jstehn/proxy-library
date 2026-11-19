import { z } from "zod";
import { type PrintingCard } from "@/modules/catalog";
import {
  type CardRules,
  type DeckCombo,
  type DeckLine,
  type Grouping,
  describeDeckError,
} from "@/modules/decks";
import { action } from "@/server/action-instance";
import type { ActionContext } from "@/server/action";
import { type Result } from "@/shared/kernel";

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

/** The deck as the builder shows it, with what the browser needs to check its rules. */
export type BuilderDeck = Readonly<{
  lines: DeckLine[];
  /** The rules facts of every card in the deck, for `deckProblems` in the browser. */
  rules: Record<string, CardRules>;
  /** Card details for every line, for name previews. */
  cards: Record<string, PrintingCard>;
  /** By type or by the deck's own headings, and those headings in order (design doc 34). */
  grouping: Grouping;
  headings: string[];
  /** Two-card combos detected in the deck (design doc 52), or undefined if not synced. */
  combos?: readonly DeckCombo[];
}>;

export async function loadDeck(
  { actor, capabilities }: ActionContext,
  deckId: number,
): Promise<BuilderDeck | null> {
  const result = await capabilities.deckOverview({
    userId: actor.userId,
    deckId,
    parts: { printings: true },
  });
  if (!result.ok) return null;
  const { view, printings, combos } = result.value;
  return {
    lines: view.lines,
    rules: { ...view.rules },
    cards: Object.fromEntries(printings ?? []),
    grouping: view.deck.grouping,
    headings: [...view.deck.headings],
    combos,
  };
}

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
