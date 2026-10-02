import { recordEvent } from "@/modules/activity";
import type { PrintingId } from "@/modules/catalog";
import { receiveCards, type CardGain } from "@/modules/collection";
import { createDeckInTransaction, type DeckCardInput } from "@/modules/decks";
import type { Result, UserId } from "@/shared/kernel";
import type { DraftCardFacts, FactsLookup } from "../domain/auto-pick";
import { planBasicLands } from "../domain/basics";
import { isBot, poolOf, type Draft, type DraftCard, type Seat } from "../domain/draft";
import { suggestBuild } from "../domain/suggested-build";
import type { DeckId, TooManyDecks } from "@/modules/decks";
import type { DraftsServices } from "./ports";

// What happens after any change to a draft, in the same transaction: new picks and dealt basics go
// into players' collections (rules 8 and 15; a bot's picks go to the admin who added it), a
// finished draft makes every person's deck (rule 12), and browsers hear about it once the
// transaction commits (rule 14).

const cardKey = (packNumber: number, slot: number) => `${packNumber}/${slot}`;

/** The cards picked in `after` that weren't picked in `before`, with who picked them. */
function newPicks(before: Draft, after: Draft): Array<{ seat: number; card: DraftCard }> {
  const pickedBefore = new Set<string>();
  for (const pack of before.packs) {
    for (const card of pack.cards) {
      if (card.pick !== null) pickedBefore.add(cardKey(pack.packNumber, card.slot));
    }
  }
  return after.packs.flatMap((pack) =>
    pack.cards
      .filter(
        (card) => card.pick !== null && !pickedBefore.has(cardKey(pack.packNumber, card.slot)),
      )
      .map((card) => ({ seat: card.pick?.seat ?? -1, card })),
  );
}

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

/** Saves a change to a draft, with everything that has to happen alongside it. */
export async function settle(
  services: DraftsServices,
  before: Draft,
  after: Draft,
  now: Date,
): Promise<void> {
  const picks = newPicks(before, after);
  const userOf = new Map<number, UserId>(after.seats.map((seat) => [seat.seatNumber, seat.userId]));
  const gains = new Map<UserId, CardGain[]>();
  function give(userId: UserId, card: Pick<DraftCard, "printingId" | "finish">) {
    const list = gains.get(userId) ?? [];
    list.push({ printingId: card.printingId, finish: card.finish, quantity: 1 });
    gains.set(userId, list);
  }
  for (const { seat, card } of picks) {
    const userId = userOf.get(seat);
    if (userId === undefined) throw new Error(`a pick by seat ${seat}, which isn't at the table`);
    give(userId, card);
  }
  // The basics taken out of the packs, dealt when the draft started.
  if (before.basicsHandedOut.length === 0) {
    for (const basic of after.basicsHandedOut) give(basic.userId, basic);
  }
  for (const [userId, cards] of gains) {
    await receiveCards(services, userId, cards, {
      source: "draft",
      ref: `draft:${after.id}`,
      at: now,
    });
  }

  await services.drafts.save(before, after);
  if (after.status === "finished" && before.status !== "finished") {
    await finish(services, after, now);
  }
  if (after.version !== before.version) {
    await services.draftNotifier.changed(after.id, after.version);
  }
}
