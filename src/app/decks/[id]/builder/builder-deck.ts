import type { PrintingCard } from "@/modules/catalog";
import type { CardRules, DeckCombo, DeckLine, Grouping } from "@/modules/decks";
import type { Capabilities } from "@/server/composition/capabilities";
import type { Actor } from "@/modules/accounts";

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

/** Loads the deck for the builder, or null if it isn't the player's. */
export async function builderDeckFor(
  capabilities: Capabilities,
  actor: Actor,
  deckId: number,
): Promise<BuilderDeck | null> {
  const result = await capabilities.deckOverview(actor, { deckId, parts: { printings: true } });
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
