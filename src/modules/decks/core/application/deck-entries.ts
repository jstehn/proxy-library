// Changing the card lines of one deck: counts, notes, role and pin, moves, batches. Every use case works only on the actor's own decks (rule 7): someone else's deck is
// reported as not found.

import type { Actor } from "@/modules/accounts";
import type { PrintingId } from "@/modules/catalog";
import { type Finish, type Result, err, ok } from "@/shared/kernel";
import {
  checkQuantity,
  MAX_QUANTITY,
  movedEntry,
  withEntry,
  type Board,
  type DeckId,
  type EntryMove,
} from "../domain/deck";
import { checkHeading, tidyHeadings } from "../domain/headings";
import { checkNote } from "../domain/headings";
import type {
  CardNotFound,
  CommanderMove,
  EntryNotFound,
  DeckChanged,
  HeadingInvalid,
  DeckNotFound,
  NoteInvalid,
  QuantityInvalid,
} from "../domain/errors";
import { fingerprint } from "../domain/list-format";
import type { DecksDependencies } from "./ports";

export type SetEntryError = DeckNotFound | QuantityInvalid | CardNotFound | NoteInvalid;

export type ApplyChangesError =
  DeckNotFound | DeckChanged | QuantityInvalid | CardNotFound | NoteInvalid | HeadingInvalid;

export type MoveEntryError = DeckNotFound | EntryNotFound | CommanderMove;

export type MoveEntryInput = EntryMove & Readonly<{ deckId: DeckId }>;

export type SetEntryInput = Readonly<{
  deckId: DeckId;
  oracleId: string;
  board: Board;
  quantity: number;
  printingId?: PrintingId;
  finish?: Finish;
  note?: string | null;
  tags?: readonly string[];
}>;

export type SetEntryDetailsInput = Readonly<{
  deckId: DeckId;
  oracleId: string;
  board: Board;
  /** The card's one-line job (trimmed, at most 160 characters), null to clear, or left out. */
  role?: string | null;
  /** Pin it (tools never suggest cutting it) or unpin it, or left out (design doc 61). */
  pinned?: boolean;
}>;

export type SetEntryDetailsError = DeckNotFound | EntryNotFound;

export type SetEntryNoteInput = Readonly<{
  deckId: DeckId;
  oracleId: string;
  board: Board;
  /** The note explaining why this card is in the deck, or null to clear it (design doc 41). */
  note: string | null;
}>;

export type SetEntryNoteError = DeckNotFound | EntryNotFound | NoteInvalid;

export type AddCardsInput = Readonly<{
  deckId: DeckId;
  /** Copies to add to the main deck, on top of any it has (design doc 35's planned lands). */
  cards: ReadonlyArray<Readonly<{ oracleId: string; quantity: number }>>;
}>;

export type ApplyChangesInput = Readonly<{
  deckId: DeckId;
  fingerprint: string;
  changes: ReadonlyArray<
    Readonly<{
      oracleId: string;
      board: Board;
      quantity?: number;
      note?: string | null;
      heading?: string | null;
      tags?: readonly string[];
      role?: string | null;
      pinned?: boolean;
    }>
  >;
}>;

export type ApplyChangesReport = Readonly<{ cards: number; fingerprint: string }>;

function checkedOptionalNote(
  note: string | null | undefined,
): Result<string | null | undefined, NoteInvalid> {
  if (note === undefined) return ok(undefined);
  if (note === null) return ok(null);
  return checkNote(note);
}

export function makeDeckEntries(dependencies: DecksDependencies) {
  const { unitOfWork, clock } = dependencies;

  /** Sets how many of a card are on one board (0 removes it). */
  async function setEntry(
    actor: Actor,
    input: SetEntryInput,
  ): Promise<Result<void, SetEntryError>> {
    const quantity = checkQuantity(input.quantity);
    if (!quantity.ok) return quantity;
    const note = checkedOptionalNote(input.note);
    if (!note.ok) return note;
    return unitOfWork.run<void, SetEntryError>(async ({ decks, cards }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      if (quantity.value > 0 && !(await cards.exists(input.oracleId)))
        return err({ kind: "CardNotFound" });
      const changed = withEntry(deck, {
        oracleId: input.oracleId,
        board: input.board,
        quantity: quantity.value,
        printingId: input.printingId,
        finish: input.finish,
        ...(note.value !== undefined ? { note: note.value } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      });
      await decks.save(changed, clock.now());
      return ok();
    });
  }

  /** Adds copies of several cards to the main deck in one go (design doc 35: planned lands). */
  async function addCards(
    actor: Actor,
    input: AddCardsInput,
  ): Promise<Result<void, SetEntryError>> {
    return unitOfWork.run<void, SetEntryError>(async ({ decks, cards }) => {
      let deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      for (const card of input.cards) {
        const existing = deck.entries.find(
          (entry) => entry.oracleId === card.oracleId && entry.board === "main",
        );
        const quantity = checkQuantity((existing?.quantity ?? 0) + card.quantity);
        if (!quantity.ok) return quantity;
        if (card.quantity < 1) return err({ kind: "QuantityInvalid", maximum: MAX_QUANTITY });
        if (!(await cards.exists(card.oracleId))) return err({ kind: "CardNotFound" });
        deck = withEntry(deck, {
          oracleId: card.oracleId,
          board: "main",
          quantity: quantity.value,
        });
      }
      await decks.save(deck, clock.now());
      return ok();
    });
  }

  /**
   * Applies a batch of count changes all-or-nothing, refusing if the deck changed since the
   * preview's fingerprint (design doc 40, section 4).
   */
  async function applyChanges(
    actor: Actor,
    input: ApplyChangesInput,
  ): Promise<Result<ApplyChangesReport, ApplyChangesError>> {
    const normalized: Array<{
      oracleId: string;
      board: Board;
      quantity?: number;
      note?: string | null;
      heading?: string | null;
      tags?: readonly string[];
      role?: string | null;
      pinned?: boolean;
    }> = [];
    for (const change of input.changes) {
      let qty: number | undefined;
      if (change.quantity !== undefined) {
        const quantity = checkQuantity(change.quantity);
        if (!quantity.ok) return quantity;
        qty = quantity.value;
      }
      const note = checkedOptionalNote(change.note);
      if (!note.ok) return note;
      let headingVal: string | null | undefined;
      if (change.heading !== undefined) {
        const checkedHeading = change.heading === null ? ok(null) : checkHeading(change.heading);
        if (!checkedHeading.ok) return checkedHeading;
        headingVal = checkedHeading.value;
      }
      normalized.push({
        oracleId: change.oracleId,
        board: change.board,
        ...(qty !== undefined ? { quantity: qty } : {}),
        ...(note.value !== undefined ? { note: note.value } : {}),
        ...(headingVal !== undefined ? { heading: headingVal } : {}),
        ...(change.tags !== undefined ? { tags: change.tags } : {}),
        ...(change.role !== undefined ? { role: change.role } : {}),
        ...(change.pinned !== undefined ? { pinned: change.pinned } : {}),
      });
    }
    return unitOfWork.run<ApplyChangesReport, ApplyChangesError>(async ({ decks, cards }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      if (fingerprint(deck.entries) !== input.fingerprint) return err({ kind: "DeckChanged" });

      let updated = deck;
      for (const change of normalized) {
        const existing = updated.entries.find(
          (e) => e.oracleId === change.oracleId && e.board === change.board,
        );
        const resolvedQuantity = change.quantity ?? existing?.quantity;
        if (resolvedQuantity === undefined) {
          return err({ kind: "QuantityInvalid", maximum: MAX_QUANTITY });
        }
        if (resolvedQuantity > 0 && !(await cards.exists(change.oracleId))) {
          return err({ kind: "CardNotFound" });
        }
        updated = withEntry(updated, {
          ...change,
          quantity: resolvedQuantity,
        });
      }
      updated = tidyHeadings(updated);
      await decks.save(updated, clock.now());
      return ok({
        cards: updated.entries.reduce((total, entry) => total + entry.quantity, 0),
        fingerprint: fingerprint(updated.entries),
      });
    });
  }

  /** Moves a card's line to another board, such as the maybeboard and back (design doc 32). */
  async function moveEntry(
    actor: Actor,
    input: MoveEntryInput,
  ): Promise<Result<void, MoveEntryError>> {
    return unitOfWork.run<void, MoveEntryError>(async ({ decks }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const moved = movedEntry(deck, input);
      if (!moved.ok) return moved;
      await decks.save(moved.value, clock.now());
      return ok();
    });
  }

  /** Sets or clears a line's note ("why this card is here", design doc 41). */
  async function setEntryNote(
    actor: Actor,
    input: SetEntryNoteInput,
  ): Promise<Result<void, SetEntryNoteError>> {
    const note = checkedOptionalNote(input.note);
    if (!note.ok) return note;
    return unitOfWork.run<void, SetEntryNoteError>(async ({ decks }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const line = deck.entries.find(
        (entry) => entry.oracleId === input.oracleId && entry.board === input.board,
      );
      if (line === undefined) return err({ kind: "EntryNotFound" });
      const changed = withEntry(deck, {
        ...line,
        note: note.value ?? null,
      });
      await decks.save(changed, clock.now());
      return ok();
    });
  }

  /** Sets a line's role and whether it's pinned (design doc 61); either may be left out. */
  async function setEntryDetails(
    actor: Actor,
    input: SetEntryDetailsInput,
  ): Promise<Result<void, SetEntryDetailsError>> {
    return unitOfWork.run<void, SetEntryDetailsError>(async ({ decks }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const line = deck.entries.find(
        (entry) => entry.oracleId === input.oracleId && entry.board === input.board,
      );
      if (line === undefined) return err({ kind: "EntryNotFound" });
      const changed = withEntry(deck, {
        ...line,
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      });
      await decks.save(changed, clock.now());
      return ok();
    });
  }

  return {
    setEntry,
    addCards,
    applyChanges,
    moveEntry,
    setEntryNote,
    setEntryDetails,
  };
}
