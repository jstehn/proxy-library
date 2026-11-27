import { withFeatures, type deckView } from "@/modules/decks/core";
import type { DbExecutor } from "@/shared/db";
import type { UserId } from "@/shared/kernel";
import type { DeckLine } from "@/modules/decks/core/client";
import type { DeckChange } from "../domain/preview";
import { loadCardsForPreview } from "./preview";

// The deck as it would be after a preview's changes, with what the cast simulator reads from each
// line (design doc 72). Nothing is saved; added cards are loaded the way a preview loads them.

type SavedView = NonNullable<Awaited<ReturnType<typeof deckView>>>;

/** The part of a deck line the cast simulator reads. */
export type AfterLine = Pick<
  DeckLine,
  | "oracleId"
  | "printingId"
  | "board"
  | "quantity"
  | "name"
  | "typeLine"
  | "manaValue"
  | "manaCost"
  | "keywords"
  | "roles"
  | "producedMana"
>;

/** The deck's lines with the changes applied, and the tap/land features of each card. */
export async function deckViewAfterChanges(
  db: DbExecutor,
  userId: UserId,
  view: SavedView,
  changes: readonly DeckChange[],
) {
  const known = new Set(view.lines.map((line) => line.oracleId));
  const added = await loadCardsForPreview(
    db,
    userId,
    view.deck.usesRealCards,
    changes.filter((change) => !known.has(change.oracleId)).map((change) => change.oracleId),
  );

  const lines: AfterLine[] = view.lines.map((line) => ({ ...line }));
  for (const change of changes) {
    const existing = lines.findIndex(
      (line) => line.oracleId === change.oracleId && line.board === change.board,
    );
    if (existing >= 0) {
      lines[existing] = { ...lines[existing], quantity: change.quantity };
      continue;
    }
    // The same card may sit on another board already; only a card new to the deck is loaded.
    const sibling = lines.find((line) => line.oracleId === change.oracleId);
    const loaded = added.get(change.oracleId);
    if (sibling !== undefined) {
      lines.push({ ...sibling, board: change.board, quantity: change.quantity });
    } else if (loaded !== undefined) {
      lines.push({
        oracleId: loaded.oracleId,
        printingId: loaded.oracleId,
        board: change.board,
        quantity: change.quantity,
        name: loaded.name,
        typeLine: loaded.typeLine,
        manaValue: loaded.manaValue,
        manaCost: loaded.manaCost ?? null,
        keywords: [...(loaded.keywords ?? [])],
        roles: loaded.roles ?? [],
        producedMana: [...(loaded.producedMana ?? [])],
      });
    }
  }
  return {
    ...view,
    lines: await withFeatures(
      db,
      lines.filter((line) => line.quantity > 0),
    ),
  };
}
