// A deck's own headings: set on a line, rename, order (design doc 34). Every use case works only on the actor's own decks (rule 7): someone else's deck is
// reported as not found.

import type { Actor } from "@/modules/accounts";
import { type Result, err, ok } from "@/shared/kernel";
import { withEntry, type Board, type DeckId } from "../domain/deck";
import {
  checkHeading,
  MAX_HEADINGS,
  orderedHeadings,
  renamedHeading,
  tidyHeadings,
} from "../domain/headings";
import type {
  EntryNotFound,
  HeadingInvalid,
  HeadingNotFound,
  HeadingOrderInvalid,
  DeckNotFound,
  TooManyHeadings,
} from "../domain/errors";
import type { DecksDependencies } from "./ports";

export type SetEntryHeadingError = DeckNotFound | EntryNotFound | HeadingInvalid | TooManyHeadings;

export type SetEntryHeadingInput = Readonly<{
  deckId: DeckId;
  oracleId: string;
  board: Board;
  /** The heading, or null to clear it (design doc 34). */
  heading: string | null;
}>;

export type RenameHeadingError = DeckNotFound | HeadingInvalid | HeadingNotFound;

export type RenameHeadingInput = Readonly<{
  deckId: DeckId;
  from: string;
  /** A new name, another heading to merge into, or null to clear it from every card. */
  to: string | null;
}>;

export type OrderHeadingsError = DeckNotFound | HeadingOrderInvalid;

export function makeDeckHeadings(dependencies: DecksDependencies) {
  const { unitOfWork, clock } = dependencies;

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

  return {
    setEntryHeading,
    renameHeading,
    orderHeadings,
  };
}
