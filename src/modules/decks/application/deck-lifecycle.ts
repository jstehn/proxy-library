// Creating, renaming, copying and deleting whole decks (design doc 09, section 5). Every use case works only on the actor's own decks (rule 7): someone else's deck is
// reported as not found.

import type { Actor } from "@/modules/accounts";
import { type Result, err, ok } from "@/shared/kernel";
import {
  checkName,
  checkTargetBracket,
  copyDeckName,
  MAX_DECKS,
  MAX_NAME_LENGTH,
  type DeckId,
  type Format,
  type Grouping,
} from "../domain/deck";
import type {
  DeckNotFound,
  NameInvalid,
  TargetBracketInvalid,
  TargetBracketNotCommander,
  TooManyDecks,
} from "../domain/errors";
import { createDeckInTransaction, type DeckCardInput } from "./create-deck-in-transaction";
import type { DecksDependencies } from "./ports";

// (rule 7): someone else's deck is reported as not found.
export type CreateDeckError = NameInvalid | TooManyDecks;

export type UpdateDeckError =
  DeckNotFound | NameInvalid | TargetBracketInvalid | TargetBracketNotCommander;

export type CopyDeckError = DeckNotFound | TooManyDecks;

export function makeDeckLifecycle(dependencies: DecksDependencies) {
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

  /** Copies a viewable deck (shared or public link) into a new private deck for the actor. */
  async function copyDeck(
    actor: Actor,
    source: Readonly<{ kind: "deck"; deckId: DeckId } | { kind: "publicToken"; token: string }>,
  ): Promise<Result<DeckId, CopyDeckError>> {
    return unitOfWork.run<DeckId, CopyDeckError>(async ({ decks }) => {
      if ((await decks.countFor(actor.userId)) >= MAX_DECKS) {
        return err({ kind: "TooManyDecks", maximum: MAX_DECKS });
      }
      const original = await decks.findReadable(
        source.kind === "deck"
          ? { kind: "deck", deckId: source.deckId, viewerId: actor.userId }
          : { kind: "publicToken", token: source.token },
      );
      if (original === null) return err({ kind: "DeckNotFound" });
      const now = clock.now();
      const newId = await decks.create({
        ownerId: actor.userId,
        name: copyDeckName(original.name),
        format: original.format,
        origin: null,
        usesRealCards: true,
        at: now,
      });
      const created = await decks.lockOwned(newId, actor.userId);
      if (created === null) throw new Error(`deck ${newId} vanished inside its own transaction`);
      await decks.save(
        {
          ...created,
          targetBracket: original.targetBracket,
          grouping: original.grouping,
          headings: [...original.headings],
          entries: original.entries.map((entry) => ({
            oracleId: entry.oracleId,
            board: entry.board,
            quantity: entry.quantity,
            printingId: null,
            finish: null,
            heading: entry.heading,
            note: null,
          })),
        },
        now,
      );
      return ok(newId);
    });
  }

  return {
    createDeck,
    updateDeck,
    deleteDeck,
    createDeckFromCards,
    copyDeck,
  };
}
