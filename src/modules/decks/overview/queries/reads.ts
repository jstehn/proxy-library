import type { Actor } from "@/modules/accounts";
import type { DbExecutor } from "@/shared/db";
import type { DraftOptions } from "@/modules/decks/building/client";
import {
  browseCollection,
  type BrowseInput,
  commanderDetails as detailsOfCommander,
  commandersICanBuild as buildable,
  draftForDeck,
  budgetList as budgetOf,
  candidatePool,
  deckSuggestions,
  similarCards,
} from "@/modules/decks/building";
import type { CommanderSearch } from "@/modules/decks/building";
import {
  decksFor as decksOf,
  decksUsing as decksUsingPrintings,
  deckView as viewOfOwnDeck,
  otherDecksHolding as otherDecksOf,
  cardPrintings,
} from "@/modules/decks/core";
import { deckListPreview } from "@/modules/decks/changes";
import { cardsToGetFor } from "@/modules/decks/sharing";
import { optimizeDeckForView, type OptimizeDeckPool } from "./optimize";
import { compareDeckSnapshot, listDeckSnapshots } from "./snapshots";

// The decks module's player reads (design doc 67, kind P), bound into `reads.decks` by
// `src/server/composition/reads.ts`. Each takes the `Actor` and passes the actor's own id to the query that
// does the work, so a page can't ask for another player's deck. The queries themselves keep a
// plain `userId` because capabilities in this module, which already hold the actor, call them too
// (design doc 67, section 7B). Reads that show a deck to someone else live in `sharing.ts` and
// `public.ts`.

/** The actor's deck, ready for the builder, or null if it isn't theirs (R21). */
export function deckView(db: DbExecutor, actor: Actor, deckId: number) {
  return viewOfOwnDeck(db, actor.userId, deckId);
}

/** For each printing, the actor's decks that use its card (R22). */
export function decksUsing(db: DbExecutor, actor: Actor, printingIds: readonly string[]) {
  return decksUsingPrintings(db, actor.userId, printingIds);
}

/** The actor's decks, most recently changed first (R25). */
export function decksFor(db: DbExecutor, actor: Actor) {
  return decksOf(db, actor.userId);
}

/** The cards the actor's decks are short of (R27). */
export function cardsToGet(db: DbExecutor, actor: Actor) {
  return cardsToGetFor(db, actor.userId);
}

/** One card's coverage as a commander, from the actor's cards (R28). */
export function commanderDetails(db: DbExecutor, actor: Actor, oracleId: string, withReal = false) {
  return detailsOfCommander(db, actor.userId, oracleId, withReal);
}

/** Every card that could lead a deck, ranked by how much of it the actor's cards cover (R29). */
export function commandersICanBuild(db: DbExecutor, actor: Actor, search: CommanderSearch = {}) {
  return buildable(db, actor.userId, search);
}

/** The list-edit dry run for one of the actor's decks (R33). */
export function listPreview(
  db: DbExecutor,
  actor: Actor,
  deckId: number,
  text: string,
  expectedFingerprint: string,
) {
  return deckListPreview(db, actor.userId, deckId, text, expectedFingerprint);
}

/** One page of the cards for one of the actor's decks (R35). */
export function browse(db: DbExecutor, actor: Actor, input: BrowseInput) {
  return browseCollection(db, actor.userId, input);
}

/** The printings of a card, with the actor's copies first, for one of their decks (R36). */
export function printingsOf(db: DbExecutor, actor: Actor, deckId: number, oracleId: string) {
  return cardPrintings(db, actor.userId, deckId, oracleId);
}

/** The actor's other decks that hold a card (R37). */
export function otherDecksHolding(db: DbExecutor, actor: Actor, deckId: number, oracleId: string) {
  return otherDecksOf(db, actor.userId, deckId, oracleId);
}

/** Cards for one of the actor's decks and for each role it is short of (R38). */
export function suggestions(db: DbExecutor, actor: Actor, deckId: number) {
  return deckSuggestions(candidatePool(db, actor.userId), deckId);
}

/** The whole-deck optimizer's answer for one of the actor's decks (R39). */
export async function optimize(
  db: DbExecutor,
  actor: Actor,
  deckId: number,
  pool: OptimizeDeckPool,
) {
  return (await optimizeDeckForView(db, actor.userId, deckId, { pool }))?.result ?? null;
}

/** A drafted full list for one of the actor's decks (R40). */
export function draft(db: DbExecutor, actor: Actor, deckId: number, options: DraftOptions = {}) {
  return draftForDeck(db, actor.userId, deckId, options);
}

/** Cards like one card, for one of the actor's decks (R41). */
export function similar(db: DbExecutor, actor: Actor, deckId: number, oracleId: string) {
  return similarCards(candidatePool(db, actor.userId), deckId, oracleId);
}

/** Store cards for one of the actor's decks within a budget (R42). */
export function budgetList(db: DbExecutor, actor: Actor, deckId: number, budgetCents: number) {
  return budgetOf(candidatePool(db, actor.userId), deckId, budgetCents);
}

/** The saved snapshots of one of the actor's decks (R43). */
export function snapshots(db: DbExecutor, actor: Actor, deckId: number) {
  return listDeckSnapshots(db, actor.userId, deckId);
}

/** A snapshot compared with another or with the live deck, for one of the actor's decks (R44). */
export function compareSnapshots(
  db: DbExecutor,
  actor: Actor,
  deckId: number,
  beforeSnapshotId: number,
  afterSnapshotId?: number,
) {
  return compareDeckSnapshot(db, actor.userId, deckId, beforeSnapshotId, afterSnapshotId);
}
