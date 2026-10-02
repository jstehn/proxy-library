import { recordEvent } from "@/modules/activity";
import type { PrintingId } from "@/modules/catalog";
import { giveUpCards, receiveCards, type CardGain } from "@/modules/collection";
import { createDeckInTransaction, type DeckCardInput } from "@/modules/decks";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import type { DraftCardFacts, FactsLookup } from "../domain/auto-pick";
import { planBasicLands } from "../domain/basics";
import { isBot, poolOf, type Draft, type DraftCard, type Seat } from "../domain/draft";
import type { CardNoLongerOwned } from "../domain/errors";
import { suggestBuild } from "../domain/suggested-build";
import type { DeckId, TooManyDecks } from "@/modules/decks";
import type { DraftsServices } from "./ports";

// What happens after any change to a draft, in the same transaction: new picks and dealt basics go
// into players' collections (rules 8 and 15; a bot's picks go to the admin who added it), a
// finished draft makes every person's deck (rule 12), and browsers hear about it once the
// transaction commits (rule 14).

const cardKey = (packNumber: number, slot: number) => `${packNumber}/${slot}`;

/** Every printing in a draft's packs, for one facts query. */
export function printingsIn(draft: Draft): PrintingId[] {
  return [...new Set(draft.packs.flatMap((pack) => pack.cards.map((card) => card.printingId)))];
}

export async function loadFacts(services: DraftsServices, draft: Draft): Promise<FactsLookup> {
  const facts: Map<PrintingId, DraftCardFacts> = await services.draftCatalog.cardFacts(
    printingsIn(draft),
  );
  return (printingId) => facts.get(printingId);
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * Makes a seat's draft deck: the suggested build on the main board, basics from the catalog, the
 * rest of the pool on the sideboard (rule 12).
 */
export async function makeDeckFor(
  services: DraftsServices,
  draft: Draft,
  seat: Seat,
  facts: FactsLookup,
  now: Date,
): Promise<Result<DeckId, TooManyDecks>> {
  const build = suggestBuild(poolOf(draft, seat.seatNumber), facts);
  const setName = await services.draftCatalog.setName(draft.setCode);
  // Basics come from the player's own collection, topped up for free when short (rule 17).
  const lands = planBasicLands(
    build.basics,
    await services.draftCatalog.ownedBasics(seat.userId),
    await services.draftCatalog.basicLands(draft.setCode),
  );
  if (lands.free.length > 0) {
    await receiveCards(services, seat.userId, lands.free, {
      source: "draft",
      ref: `draft:${draft.id}`,
      at: now,
    });
  }
  const card = (each: DraftCard, board: "main" | "side"): DeckCardInput => ({
    printingId: each.printingId,
    finish: each.finish,
    quantity: 1,
    board,
  });
  const made = await createDeckInTransaction(services, {
    ownerId: seat.userId,
    name: `${setName} draft, ${DATE_FORMAT.format(draft.startedAt ?? now)}`,
    format: "limited",
    origin: { kind: "draft", draftId: draft.id },
    cards: [
      ...build.main.map((each) => card(each, "main")),
      ...lands.deck.map((land) => ({ ...land, board: "main" as const })),
      ...build.side.map((each) => card(each, "side")),
    ],
    now,
  });
  if (made.ok) await services.drafts.setDeckOf(draft.id, seat.userId, made.value);
  return made;
}

async function finish(services: DraftsServices, draft: Draft, now: Date): Promise<void> {
  const facts = await loadFacts(services, draft);
  // A player at the deck limit gets no deck now; the draft page offers "Make a deck" later.
  for (const seat of draft.seats.filter((each) => !isBot(each))) {
    await makeDeckFor(services, draft, seat, facts, now);
  }
  // A draft with bots is an admin's test: the feed doesn't announce it.
  if (draft.seats.some(isBot)) return;
  await recordEvent(
    services,
    {
      kind: "draft",
      actorId: draft.hostId,
      setName: await services.draftCatalog.setName(draft.setCode),
      players: draft.seats.length,
    },
    now,
  );
}

/** A card that changes hands in a draft: who loses it (if anyone) and who gets it (if anyone). */
type Move = Readonly<{
  from: UserId | null;
  to: UserId | null;
  card: Pick<DraftCard, "printingId" | "finish">;
}>;

/**
 * What a change does to collections (rules 8 and 15; design doc 18): a newly drafted card goes to
 * its drafter (removed cards too, decision 1), a Librarian put back into a pack leaves its
 * drafter's collection, a Deal Broker swap moves both cards, and newly dealt basics go to their
 * players. A bot's cards belong to the admin who added it.
 */
function collectionMoves(before: Draft, after: Draft): Move[] {
  const userOf = (seat: number) => {
    const found = after.seats.find((each) => each.seatNumber === seat);
    if (found === undefined) throw new Error(`seat ${seat} isn't at the table`);
    return found.userId;
  };
  const previous = new Map<string, DraftCard>();
  for (const pack of before.packs) {
    for (const card of pack.cards) previous.set(cardKey(pack.packNumber, card.slot), card);
  }
  const moves: Move[] = [];
  for (const pack of after.packs) {
    for (const card of pack.cards) {
      const was = previous.get(cardKey(pack.packNumber, card.slot))?.pick ?? null;
      const now = card.pick;
      if (now === null) continue;
      if (was === null) moves.push({ from: null, to: userOf(now.seat), card });
      if (now.state === "returned" && was?.state !== "returned") {
        moves.push({ from: userOf(now.seat), to: null, card });
      }
      if (was !== null && was.poolSeat !== now.poolSeat) {
        moves.push({ from: userOf(was.poolSeat), to: userOf(now.poolSeat), card });
      }
    }
  }
  for (const basic of after.basicsHandedOut.slice(before.basicsHandedOut.length)) {
    moves.push({ from: null, to: basic.userId, card: basic });
  }
  return moves;
}

/** Saves a change to a draft, with everything that has to happen alongside it. */
export async function settle(
  services: DraftsServices,
  before: Draft,
  after: Draft,
  now: Date,
): Promise<Result<void, CardNoLongerOwned>> {
  const acquisition = { source: "draft" as const, ref: `draft:${after.id}`, at: now };
  const moves = collectionMoves(before, after);
  const losses = new Map<UserId, CardGain[]>();
  const gains = new Map<UserId, CardGain[]>();
  for (const move of moves) {
    const gain = { printingId: move.card.printingId, finish: move.card.finish, quantity: 1 };
    if (move.from !== null) losses.set(move.from, [...(losses.get(move.from) ?? []), gain]);
    if (move.to !== null) gains.set(move.to, [...(gains.get(move.to) ?? []), gain]);
  }
  for (const [userId, cards] of losses) {
    // Sold mid-draft, say: the change can't happen, and the whole transaction rolls back.
    const given = await giveUpCards(services, userId, cards, acquisition);
    if (!given.ok) return err({ kind: "CardNoLongerOwned" });
  }
  for (const [userId, cards] of gains) await receiveCards(services, userId, cards, acquisition);

  await services.drafts.save(before, after);
  if (after.status === "finished" && before.status !== "finished") {
    await finish(services, after, now);
  }
  if (after.version !== before.version) {
    await services.draftNotifier.changed(after.id, after.version);
  }
  return ok();
}
