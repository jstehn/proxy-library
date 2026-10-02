import type { Finish, PrintingId } from "@/modules/catalog";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import {
  checkName,
  MAX_DECKS,
  MAX_NAME_LENGTH,
  MAX_QUANTITY,
  withEntry,
  type Board,
  type DeckId,
  type DeckOrigin,
  type Format,
} from "../domain/deck";
import type { TooManyDecks } from "../domain/errors";
import type { DecksServices } from "./ports";

/** One card for a new deck: a printing, its finish, and where it goes. */
export type DeckCardInput = Readonly<{
  printingId: PrintingId;
  finish: Finish;
  quantity: number;
  board: Board;
}>;

export type NewDeckInput = Readonly<{
  ownerId: UserId;
  name: string;
  format: Format;
  origin: DeckOrigin | null;
  cards: readonly DeckCardInput[];
  now: Date;
}>;

/**
 * Makes a deck from cards, keeping each card's printing, finish and board, inside the caller's
 * transaction: an opened precon (through `createDeckFromCards`), or a finished draft, whose
 * last pick makes every player's deck in the same transaction (design doc 17, rule 12). A name
 * that's too long is cut short; cards the catalog doesn't know are left out.
 */
export async function createDeckInTransaction(
  services: DecksServices,
  input: NewDeckInput,
): Promise<Result<DeckId, TooManyDecks>> {
  const { decks, cards } = services;
  const name = checkName(input.name.slice(0, MAX_NAME_LENGTH));
  if ((await decks.countFor(input.ownerId)) >= MAX_DECKS) {
    return err({ kind: "TooManyDecks", maximum: MAX_DECKS });
  }
  const id = await decks.create({
    ownerId: input.ownerId,
    name: name.ok ? name.value : "Untitled deck",
    format: input.format,
    origin: input.origin,
    at: input.now,
  });
  const oracleIds = await cards.oracleIdsOf(input.cards.map((card) => card.printingId));
  let deck = await decks.lockOwned(id, input.ownerId);
  if (deck === null) throw new Error(`deck ${id} vanished inside its own transaction`);
  for (const card of input.cards) {
    const oracleId = oracleIds.get(card.printingId);
    if (oracleId === undefined) continue; // not in the catalog: nothing to show for it
    const existing = deck.entries.find(
      (entry) => entry.oracleId === oracleId && entry.board === card.board,
    );
    deck = withEntry(deck, {
      oracleId,
      board: card.board,
      quantity: Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + card.quantity),
      printingId: card.printingId,
      finish: card.finish,
    });
  }
  await decks.save(deck, input.now);
  return ok(id);
}
