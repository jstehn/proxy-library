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
  type MatchedLine,
} from "../domain/deck";
import type {
  CardNotFound,
  CommanderMove,
  EntryNotFound,
  DeckChanged,
  DeckNotFound,
  ListProblems,
  ListTooLong,
  NameInvalid,
  TargetBracketInvalid,
  TargetBracketNotCommander,
  QuantityInvalid,
  TooManyDecks,
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
export type SetEntryError = DeckNotFound | QuantityInvalid | CardNotFound;
export type MoveEntryError = DeckNotFound | EntryNotFound | CommanderMove;
export type MoveEntryInput = EntryMove & Readonly<{ deckId: DeckId }>;
export type ReplaceListError = DeckNotFound | DeckChanged | ListProblems | ListTooLong;
export type ChoosePrintingError = DeckNotFound | PrintingRuleError;

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
}>;

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
      });
      await decks.save(changed, clock.now());
      return ok();
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
        updated = withEntry(updated, {
          oracleId: card.oracleId,
          board: line.board,
          quantity: Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + line.quantity),
          printingId: card.printingId,
          // "*F*" / "*E*" in the list choose the finish; otherwise the one found.
          finish: line.finish ?? card.finish,
        });
        added += line.quantity;
      }
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
        });
      }
      if (notFound.length > 0 || parsed.unreadable.length > 0) {
        return err({ kind: "ListProblems", unreadable: parsed.unreadable, notFound });
      }

      const entries = replacedEntries(deck.entries, lines);
      await decks.save({ ...deck, entries }, clock.now());
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

  return {
    createDeck,
    updateDeck,
    deleteDeck,
    setEntry,
    moveEntry,
    importList,
    replaceList,
    choosePrinting,
    createDeckFromCards,
  };
}
