// Importing a pasted list into a deck, and replacing the whole list (design doc 23). Every use case works only on the actor's own decks (rule 7): someone else's deck is
// reported as not found.

import type { Actor } from "@/modules/accounts";
import { type Result, err, ok } from "@/shared/kernel";
import {
  MAX_LIST_LINES,
  MAX_QUANTITY,
  replacedEntries,
  withEntry,
  type DeckId,
  type MatchedLine,
} from "../domain/deck";
import type { Board } from "../domain/boards";
import { checkHeading, tidyHeadings } from "../domain/headings";
import type { DeckChanged, DeckNotFound, ListProblems, ListTooLong } from "../domain/errors";
import { parseList } from "@/shared/card-search";
import { fingerprint } from "../domain/list-format";
import type { DecksDependencies, UnnamedPrinting } from "./ports";

export type ReplaceListError = DeckNotFound | DeckChanged | ListProblems | ListTooLong;

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

export type ImportReport = Readonly<{
  added: number;
  unreadable: string[];
  notFound: string[];
  boards?: Readonly<Partial<Record<Board, number>>>;
}>;

/** A heading read from a pasted list, if the deck can use it: not too long, not a board name. */
function usableHeading(heading: string | null): string | null {
  if (heading === null) return null;
  const checked = checkHeading(heading);
  return checked.ok ? checked.value : null;
}

export function makeDeckLists(dependencies: DecksDependencies) {
  const { unitOfWork, clock } = dependencies;

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
      const boards: Partial<Record<Board, number>> = {};
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
        boards[line.board] = (boards[line.board] ?? 0) + line.quantity;
      }
      // A deck's first headings, from a list, switch it to grouping by them (design doc 34).
      const tidied = tidyHeadings(updated);
      if (!hadHeadings && tidied.headings.length > 0) updated = { ...tidied, grouping: "custom" };
      await decks.save(updated, clock.now());
      return ok({ added, unreadable: parsed.unreadable, notFound, boards });
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

  return {
    importList,
    replaceList,
  };
}
