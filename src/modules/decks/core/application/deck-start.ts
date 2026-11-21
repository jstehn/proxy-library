import type { Actor } from "@/modules/accounts";
import { err, ok, type Result } from "@/shared/kernel";
import type { DeckId, Format } from "../domain/deck";
import type { CreateDeckError } from "./deck-lifecycle";
import type { Decks } from "./make-decks";

// Starting a deck in one go: the deck, its target bracket, real-card use, and optionally a first list.

export type StartDeckInput = Readonly<{
  name: string;
  format: Format;
  targetBracket?: 1 | 2 | 3 | 4 | 5;
  /** Cards to start with, in the usual text format; "" for an empty deck. */
  list: string;
  /** Count the player's real cards as owned (a deck of real cards); defaults to proxies. */
  usesRealCards?: boolean;
}>;

export type StartedDeck = Readonly<{
  deckId: DeckId;
  added: number;
  unreadable: readonly string[];
  notFound: readonly string[];
  /** Why the list couldn't be read at all, if it couldn't; the deck exists anyway. */
  listError: string | null;
}>;

export function makeStartDeck(decks: Pick<Decks, "createDeck" | "updateDeck" | "importList">) {
  async function startDeck(
    actor: Actor,
    input: StartDeckInput,
  ): Promise<Result<StartedDeck, CreateDeckError>> {
    const created = await decks.createDeck(actor, { name: input.name, format: input.format });
    if (!created.ok) return err(created.error);
    const deckId = created.value;
    if (input.targetBracket !== undefined) {
      await decks.updateDeck(actor, { deckId, targetBracket: input.targetBracket });
    }
    if (input.usesRealCards === true)
      await decks.updateDeck(actor, { deckId, usesRealCards: true });
    const empty = { deckId, added: 0, unreadable: [], notFound: [], listError: null };
    if (input.list.trim() === "") return ok(empty);
    const imported = await decks.importList(actor, { deckId, text: input.list });
    if (!imported.ok) return ok({ ...empty, listError: imported.error.kind });
    return ok({ deckId, listError: null, ...imported.value });
  }

  return { startDeck };
}
