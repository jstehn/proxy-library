import type { Actor } from "@/modules/accounts";
import type { Finish, PrintingId } from "@/modules/catalog";
import { err, ok, type Result } from "@/shared/kernel";
import {
  checkName,
  checkTargetBracket,
  checkQuantity,
  MAX_DECKS,
  MAX_NAME_LENGTH,
  MAX_LIST_LINES,
  MAX_QUANTITY,
  movedEntry,
  replacedEntries,
  withEntry,
  withPrinting,
  type ChoosePrintingError as PrintingRuleError,
  type Board,
  type DeckId,
  type EntryMove,
  type Format,
  type Grouping,
  type MatchedLine,
} from "../domain/deck";
import {
  checkHeading,
  MAX_HEADINGS,
  orderedHeadings,
  renamedHeading,
  tidyHeadings,
} from "../domain/headings";
import { checkNote } from "../domain/notes";
import { checkSnapshotLabel, MAX_SNAPSHOTS_PER_DECK, type SnapshotId } from "../domain/snapshots";
import type {
  CardNotFound,
  CommanderMove,
  EntryNotFound,
  DeckChanged,
  HeadingInvalid,
  HeadingNotFound,
  HeadingOrderInvalid,
  DeckNotFound,
  ListProblems,
  ListTooLong,
  NameInvalid,
  NoteInvalid,
  SnapshotLabelInvalid,
  SnapshotNotFound,
  TargetBracketInvalid,
  TargetBracketNotCommander,
  QuantityInvalid,
  TooManyDecks,
  TooManyHeadings,
  TooManySnapshots,
} from "../domain/errors";
import { parseList } from "@/shared/card-search";
import { fingerprint } from "../domain/list-format";
import { createDeckInTransaction, type DeckCardInput } from "./create-deck-in-transaction";
import type { DecksDependencies, UnnamedPrinting } from "./ports";

// Deck use cases (design doc 09, section 5). Every one works only on the actor's own decks
// (rule 7): someone else's deck is reported as not found.

export type CreateDeckError = NameInvalid | TooManyDecks;
export type UpdateDeckError =
  DeckNotFound | NameInvalid | TargetBracketInvalid | TargetBracketNotCommander;
export type SetEntryError = DeckNotFound | QuantityInvalid | CardNotFound | NoteInvalid;
export type ApplyChangesError =
  DeckNotFound | DeckChanged | QuantityInvalid | CardNotFound | NoteInvalid;
export type MoveEntryError = DeckNotFound | EntryNotFound | CommanderMove;
export type MoveEntryInput = EntryMove & Readonly<{ deckId: DeckId }>;
export type ReplaceListError = DeckNotFound | DeckChanged | ListProblems | ListTooLong;
export type ChoosePrintingError = DeckNotFound | PrintingRuleError;
export type SetEntryHeadingError = DeckNotFound | EntryNotFound | HeadingInvalid | TooManyHeadings;
export type SetEntryNoteError = DeckNotFound | EntryNotFound | NoteInvalid;
export type RenameHeadingError = DeckNotFound | HeadingInvalid | HeadingNotFound;
export type OrderHeadingsError = DeckNotFound | HeadingOrderInvalid;
export type SaveSnapshotError = DeckNotFound | SnapshotLabelInvalid | TooManySnapshots;
export type RestoreSnapshotError = DeckNotFound | SnapshotNotFound | DeckChanged;
export type DeleteSnapshotError = DeckNotFound | SnapshotNotFound;

export type SetEntryHeadingInput = Readonly<{
  deckId: DeckId;
  oracleId: string;
  board: Board;
  /** The heading, or null to clear it (design doc 34). */
  heading: string | null;
}>;

export type RenameHeadingInput = Readonly<{
  deckId: DeckId;
  from: string;
  /** A new name, another heading to merge into, or null to clear it from every card. */
  to: string | null;
}>;

export type ChoosePrintingInput = Readonly<{
  deckId: DeckId;
  oracleId: string;
  board: Board;
  /** The printing and finish to pin, or null to follow your copies again (design doc 24). */
  pinned: Readonly<{ printingId: PrintingId; finish: Finish }> | null;
}>;

export type SetEntryInput = Readonly<{
  deckId: DeckId;
  oracleId: string;
  board: Board;
  quantity: number;
  printingId?: PrintingId;
  finish?: Finish;
  note?: string | null;
}>;

export type SetEntryNoteInput = Readonly<{
  deckId: DeckId;
  oracleId: string;
  board: Board;
  /** The note explaining why this card is in the deck, or null to clear it (design doc 41). */
  note: string | null;
}>;

export type AddCardsInput = Readonly<{
  deckId: DeckId;
  /** Copies to add to the main deck, on top of any it has (design doc 35's planned lands). */
  cards: ReadonlyArray<Readonly<{ oracleId: string; quantity: number }>>;
}>;

export type ApplyChangesInput = Readonly<{
  deckId: DeckId;
  fingerprint: string;
  changes: ReadonlyArray<
    Readonly<{ oracleId: string; board: Board; quantity: number; note?: string | null }>
  >;
}>;

export type ApplyChangesReport = Readonly<{ cards: number; fingerprint: string }>;
export type ImportReport = Readonly<{ added: number; unreadable: string[]; notFound: string[] }>;

export type ReplaceListInput = Readonly<{
  deckId: DeckId;
  text: string;
  /** The fingerprint of the deck when its text box was filled (design doc 23, rule 5). */
  fingerprint: string;
  /** The printing for an unowned line that names none; the standard one unless asked. */
  unnamedPrinting?: UnnamedPrinting;
}>;

/** How many cards the deck holds after the save. */
export type ReplaceReport = Readonly<{ cards: number }>;

/** A heading read from a pasted list, if the deck can use it: not too long, not a board name. */
function usableHeading(heading: string | null): string | null {
  if (heading === null) return null;
  const checked = checkHeading(heading);
  return checked.ok ? checked.value : null;
}

function checkedOptionalNote(
  note: string | null | undefined,
): Result<string | null | undefined, NoteInvalid> {
  if (note === undefined) return ok(undefined);
  if (note === null) return ok(null);
  return checkNote(note);
}

export function makeManageDecks(dependencies: DecksDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function createDeck(
    actor: Actor,
    input: { name: string; format: Format },
  ): Promise<Result<DeckId, CreateDeckError>> {
    const name = checkName(input.name);
    if (!name.ok) return name;
    return unitOfWork.run<DeckId, CreateDeckError>(async ({ decks }) => {
      if ((await decks.countFor(actor.userId)) >= MAX_DECKS) {
        return err({ kind: "TooManyDecks", maximum: MAX_DECKS });
      }
      return ok(
        await decks.create({
          ownerId: actor.userId,
          name: name.value,
          format: input.format,
          at: clock.now(),
        }),
      );
    });
  }

  async function updateDeck(
    actor: Actor,
    input: {
      deckId: DeckId;
      name?: string;
      format?: Format;
      usesRealCards?: boolean;
      /** 1–5, null to clear, or left out to keep (design doc 31). */
      targetBracket?: number | null;
      /** By type or by the deck's own headings (design doc 34). */
      grouping?: Grouping;
    },
  ): Promise<Result<void, UpdateDeckError>> {
    const name = input.name === undefined ? ok(undefined) : checkName(input.name);
    if (!name.ok) return name;
    return unitOfWork.run<void, UpdateDeckError>(async ({ decks }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const format = input.format ?? deck.format;
      // Kept unless asked to change, but a deck leaving Commander loses it (invariant 8).
      const target =
        input.targetBracket !== undefined
          ? checkTargetBracket(format, input.targetBracket)
          : ok(format === "commander" ? deck.targetBracket : null);
      if (!target.ok) return target;
      await decks.save(
        {
          ...deck,
          name: name.value ?? deck.name,
          format,
          targetBracket: target.value,
          // "Use my real cards" (design doc 16): only this deck's counting changes.
          usesRealCards: input.usesRealCards ?? deck.usesRealCards,
          grouping: input.grouping ?? deck.grouping,
        },
        clock.now(),
      );
      return ok();
    });
  }

  async function deleteDeck(actor: Actor, deckId: DeckId): Promise<Result<void, DeckNotFound>> {
    return unitOfWork.run<void, DeckNotFound>(async ({ decks }) => {
      if ((await decks.lockOwned(deckId, actor.userId)) === null)
        return err({ kind: "DeckNotFound" });
      await decks.delete(deckId);
      return ok();
    });
  }

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
      quantity: number;
      note?: string | null;
    }> = [];
    for (const change of input.changes) {
      const quantity = checkQuantity(change.quantity);
      if (!quantity.ok) return quantity;
      const note = checkedOptionalNote(change.note);
      if (!note.ok) return note;
      normalized.push({
        oracleId: change.oracleId,
        board: change.board,
        quantity: quantity.value,
        ...(note.value !== undefined ? { note: note.value } : {}),
      });
    }
    return unitOfWork.run<ApplyChangesReport, ApplyChangesError>(async ({ decks, cards }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      if (fingerprint(deck.entries) !== input.fingerprint) return err({ kind: "DeckChanged" });

      const positiveIds = new Set(
        normalized.filter((change) => change.quantity > 0).map((change) => change.oracleId),
      );
      for (const oracleId of positiveIds) {
        if (!(await cards.exists(oracleId))) return err({ kind: "CardNotFound" });
      }

      let updated = deck;
      for (const change of normalized) {
        updated = withEntry(updated, change);
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

  /**
   * Adds a pasted list to a deck. Lines it can't read, and cards the catalog doesn't have, are
   * reported back rather than failing the whole import.
   */
  async function importList(
    actor: Actor,
    input: { deckId: DeckId; text: string },
  ): Promise<Result<ImportReport, DeckNotFound>> {
    const parsed = parseList(input.text, { keepMaybeboard: true });
    return unitOfWork.run<ImportReport, DeckNotFound>(async ({ decks, cards }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const found = await cards.resolve(actor.userId, parsed.lines, {
        includeReal: deck.usesRealCards,
        unnamedPrinting: "standard",
      });

      const notFound: string[] = [];
      let added = 0;
      let updated = deck;
      const hadHeadings = deck.headings.length > 0;
      // `entries()` gives [index, line] pairs, like Python's enumerate().
      for (const [index, line] of parsed.lines.entries()) {
        const card = found.get(index);
        if (card === undefined) {
          notFound.push(line.name);
          continue;
        }
        const existing = updated.entries.find(
          (entry) => entry.oracleId === card.oracleId && entry.board === line.board,
        );
        const heading = usableHeading(line.heading);
        updated = withEntry(updated, {
          oracleId: card.oracleId,
          board: line.board,
          quantity: Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + line.quantity),
          printingId: card.printingId,
          // "*F*" / "*E*" in the list choose the finish; otherwise the one found.
          finish: line.finish ?? card.finish,
          // A heading in the list is used; a line without one keeps the card's (design doc 34).
          ...(heading !== null ? { heading } : {}),
        });
        added += line.quantity;
      }
      // A deck's first headings, from a list, switch it to grouping by them (design doc 34).
      const tidied = tidyHeadings(updated);
      if (!hadHeadings && tidied.headings.length > 0) updated = { ...tidied, grouping: "custom" };
      await decks.save(updated, clock.now());
      return ok({ added, unreadable: parsed.unreadable, notFound });
    });
  }

  /**
   * Replaces a deck's whole list with a pasted or edited text (design doc 23). All or nothing:
   * if any line can't be read or isn't in the catalog, nothing is saved and every problem line
   * is reported. Refused if the deck changed since the text box was filled.
   */
  async function replaceList(
    actor: Actor,
    input: ReplaceListInput,
  ): Promise<Result<ReplaceReport, ReplaceListError>> {
    // Counting newlines first, so a huge paste is refused before it's read.
    if (input.text.split("\n").length > MAX_LIST_LINES) {
      return err({ kind: "ListTooLong", maximumLines: MAX_LIST_LINES });
    }
    const parsed = parseList(input.text, { keepMaybeboard: true });
    return unitOfWork.run<ReplaceReport, ReplaceListError>(async ({ decks, cards }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      // The lock is held, so nothing can change the deck between this check and the save.
      if (fingerprint(deck.entries) !== input.fingerprint) return err({ kind: "DeckChanged" });

      const found = await cards.resolve(actor.userId, parsed.lines, {
        includeReal: deck.usesRealCards,
        unnamedPrinting: input.unnamedPrinting ?? "standard",
      });
      const lines: MatchedLine[] = [];
      const notFound: string[] = [];
      for (const [index, line] of parsed.lines.entries()) {
        const card = found.get(index);
        if (card === undefined) {
          notFound.push(line.name);
          continue;
        }
        lines.push({
          oracleId: card.oracleId,
          board: line.board,
          quantity: line.quantity,
          printingId: card.printingId,
          finish: card.finish,
          namesPrinting: card.namedPrinting,
          finishMarker: line.finish,
          heading: usableHeading(line.heading),
        });
      }
      if (notFound.length > 0 || parsed.unreadable.length > 0) {
        return err({ kind: "ListProblems", unreadable: parsed.unreadable, notFound });
      }

      const entries = replacedEntries(deck.entries, lines);
      // Text with headings sets their order too: the order they come in (design doc 34).
      const textHasHeadings = lines.some((line) => line.heading !== null);
      const headings = textHasHeadings ? [] : deck.headings;
      // A deck's first headings switch it to grouping by them, as importList does.
      const grouping = deck.headings.length === 0 && textHasHeadings ? "custom" : deck.grouping;
      await decks.save({ ...deck, entries, headings, grouping }, clock.now());
      return ok({ cards: entries.reduce((total, entry) => total + entry.quantity, 0) });
    });
  }

  /**
   * Pins one deck line to a printing and finish, or unpins it (design doc 24). The printing must
   * be of the line's card, in a finish it comes in; the quantity doesn't change.
   */
  async function choosePrinting(
    actor: Actor,
    input: ChoosePrintingInput,
  ): Promise<Result<void, ChoosePrintingError>> {
    return unitOfWork.run<void, ChoosePrintingError>(async ({ decks, cards }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const pinned =
        input.pinned === null
          ? null
          : { ...input.pinned, facts: await cards.printingFacts(input.pinned.printingId) };
      const changed = withPrinting(deck, {
        oracleId: input.oracleId,
        board: input.board,
        pinned,
      });
      if (!changed.ok) return changed;
      await decks.save(changed.value, clock.now());
      return ok();
    });
  }

  /**
   * Makes a deck from cards that came out of a box (an opened precon), keeping each card's
   * printing, finish and board. Commander if it has a commander, otherwise casual.
   */
  async function createDeckFromCards(
    actor: Actor,
    input: { name: string; cards: readonly DeckCardInput[] },
  ): Promise<Result<DeckId, CreateDeckError>> {
    const name = checkName(input.name.slice(0, MAX_NAME_LENGTH));
    if (!name.ok) return name;
    const format: Format = input.cards.some((card) => card.board === "commander")
      ? "commander"
      : "casual";
    return unitOfWork.run<DeckId, CreateDeckError>((services) =>
      createDeckInTransaction(services, {
        ownerId: actor.userId,
        name: name.value,
        format,
        origin: null,
        cards: input.cards,
        now: clock.now(),
      }),
    );
  }

  /** Gives one card line a heading, or clears it (design doc 34). A new heading goes last. */
  async function setEntryHeading(
    actor: Actor,
    input: SetEntryHeadingInput,
  ): Promise<Result<void, SetEntryHeadingError>> {
    const heading = input.heading === null ? ok(null) : checkHeading(input.heading);
    if (!heading.ok) return heading;
    return unitOfWork.run<void, SetEntryHeadingError>(async ({ decks }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const line = deck.entries.find(
        (entry) => entry.oracleId === input.oracleId && entry.board === input.board,
      );
      if (line === undefined) return err({ kind: "EntryNotFound" });
      const changed = tidyHeadings(withEntry(deck, { ...line, heading: heading.value }));
      // tidyHeadings drops a heading past the limit, so a line that lost it was one too many.
      const kept = changed.entries.find(
        (entry) => entry.oracleId === input.oracleId && entry.board === input.board,
      );
      if (heading.value !== null && kept?.heading !== heading.value) {
        return err({ kind: "TooManyHeadings", maximum: MAX_HEADINGS });
      }
      await decks.save(changed, clock.now());
      return ok();
    });
  }

  /** Renames a heading on every card, merges it into another, or clears it (design doc 34). */
  async function renameHeading(
    actor: Actor,
    input: RenameHeadingInput,
  ): Promise<Result<void, RenameHeadingError>> {
    const to = input.to === null ? ok(null) : checkHeading(input.to);
    if (!to.ok) return to;
    return unitOfWork.run<void, RenameHeadingError>(async ({ decks }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const renamed = renamedHeading(deck, input.from, to.value);
      if (!renamed.ok) return renamed;
      await decks.save(renamed.value, clock.now());
      return ok();
    });
  }

  /** Puts a deck's headings in the owner's order; it must name each one once (design doc 34). */
  async function orderHeadings(
    actor: Actor,
    input: Readonly<{ deckId: DeckId; order: readonly string[] }>,
  ): Promise<Result<void, OrderHeadingsError>> {
    return unitOfWork.run<void, OrderHeadingsError>(async ({ decks }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const ordered = orderedHeadings(deck, input.order);
      if (!ordered.ok) return ordered;
      await decks.save(ordered.value, clock.now());
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

  /** Saves a point-in-time snapshot of a deck for before/after comparisons (design doc 41). */
  async function saveSnapshot(
    actor: Actor,
    input: Readonly<{ deckId: DeckId; label: string }>,
  ): Promise<Result<SnapshotId, SaveSnapshotError>> {
    const label = checkSnapshotLabel(input.label);
    if (!label.ok) return label;
    return unitOfWork.run<SnapshotId, SaveSnapshotError>(async ({ decks }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      if ((await decks.countSnapshots(deck.id)) >= MAX_SNAPSHOTS_PER_DECK) {
        return err({ kind: "TooManySnapshots", maximum: MAX_SNAPSHOTS_PER_DECK });
      }
      return ok(
        await decks.saveSnapshot({
          deckId: deck.id,
          label: label.value,
          format: deck.format,
          targetBracket: deck.targetBracket,
          grouping: deck.grouping,
          headings: [...deck.headings],
          entries: deck.entries.map((entry) => ({ ...entry })),
          createdAt: clock.now(),
        }),
      );
    });
  }

  /** Restores a deck's entries, format, target bracket, and headings from a saved snapshot. */
  async function restoreSnapshot(
    actor: Actor,
    input: Readonly<{ deckId: DeckId; snapshotId: SnapshotId; fingerprint?: string }>,
  ): Promise<Result<ApplyChangesReport, RestoreSnapshotError>> {
    return unitOfWork.run<ApplyChangesReport, RestoreSnapshotError>(async ({ decks, cards }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      if (input.fingerprint !== undefined && fingerprint(deck.entries) !== input.fingerprint) {
        return err({ kind: "DeckChanged" });
      }
      const snapshot = await decks.getSnapshot(deck.id, input.snapshotId);
      if (snapshot === null) return err({ kind: "SnapshotNotFound" });

      const knownOracles = await cards.existingOracleIds(
        snapshot.entries.map((entry) => entry.oracleId),
      );
      const pinnedPrintings = snapshot.entries.flatMap((entry) =>
        entry.printingId === null ? [] : [entry.printingId],
      );
      const knownPrintings = await cards.existingPrintings(pinnedPrintings);

      const restoredEntries = snapshot.entries
        .filter((entry) => knownOracles.has(entry.oracleId))
        .map((entry) => {
          const keepsPrinting = entry.printingId !== null && knownPrintings.has(entry.printingId);
          return {
            ...entry,
            printingId: keepsPrinting ? entry.printingId : null,
            finish: keepsPrinting ? entry.finish : null,
          };
        });

      const restored = tidyHeadings({
        ...deck,
        format: snapshot.format,
        targetBracket: snapshot.format === "commander" ? snapshot.targetBracket : null,
        grouping: snapshot.grouping,
        headings: [...snapshot.headings],
        entries: restoredEntries,
      });
      await decks.save(restored, clock.now());
      return ok({
        cards: restored.entries.reduce((total, entry) => total + entry.quantity, 0),
        fingerprint: fingerprint(restored.entries),
      });
    });
  }

  /** Deletes one saved snapshot belonging to the deck. */
  async function deleteSnapshot(
    actor: Actor,
    input: Readonly<{ deckId: DeckId; snapshotId: SnapshotId }>,
  ): Promise<Result<void, DeleteSnapshotError>> {
    return unitOfWork.run<void, DeleteSnapshotError>(async ({ decks }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const deleted = await decks.deleteSnapshot(deck.id, input.snapshotId);
      if (!deleted) return err({ kind: "SnapshotNotFound" });
      return ok();
    });
  }

  return {
    createDeck,
    updateDeck,
    setEntryHeading,
    setEntryNote,
    renameHeading,
    orderHeadings,
    deleteDeck,
    setEntry,
    addCards,
    applyChanges,
    saveSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    moveEntry,
    importList,
    replaceList,
    choosePrinting,
    createDeckFromCards,
  };
}
