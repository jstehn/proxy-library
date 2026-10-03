import { err, ok, type Result } from "@/shared/kernel";
import { sameCard, type CardRef } from "./abilities";
import { cardAt, cardsLeft, currentPack, reveal, withCard, type Draft } from "./draft";
import type { AbilityUnavailable, DraftNotRunning } from "./errors";
import { faceUpWith, type StepContext } from "./steps";

// Things a player may do at any moment of the draft, not as part of a pick (design doc 18):
// "During the draft, you may turn this card face down. If you do, …"

const unavailable = (reason: string): AbilityUnavailable => ({
  kind: "AbilityUnavailable",
  reason,
});

function hasFaceUp(
  draft: Draft,
  seatNumber: number,
  card: CardRef,
  kind: "peekPack" | "watchPlayer",
  ctx: StepContext,
) {
  return faceUpWith(draft, seatNumber, kind, ctx).some((each) => sameCard(each, card));
}

const turnFaceDown = (draft: Draft, ref: CardRef) =>
  withCard(draft, ref, (card) =>
    card.pick === null ? card : { ...card, pick: { ...card.pick, state: "faceDown" } },
  );

/**
 * The packs a Whispergear Sneak may look at: any unopened pack (a later round's), or a pack this
 * round that nobody is looking at (waiting in a queue, not in front of anyone).
 */
export function sneakablePacks(draft: Draft): number[] {
  if (draft.status !== "drafting") return [];
  const inFront = new Set(
    draft.seats
      .map((seat) => currentPack(draft, seat.seatNumber)?.packNumber)
      .filter((n) => n !== undefined),
  );
  return draft.packs
    .filter(
      (pack) =>
        pack.round > draft.round ||
        (pack.round === draft.round && cardsLeft(pack) > 0 && !inFront.has(pack.packNumber)),
    )
    .map((pack) => pack.packNumber);
}

/** Whispergear Sneak: turn it face down and look at a pack (sneakablePacks). */
export function peekAtPack(
  draft: Draft,
  seatNumber: number,
  sneak: CardRef,
  packNumber: number,
  ctx: StepContext,
): Result<Draft, DraftNotRunning | AbilityUnavailable> {
  if (draft.status !== "drafting") return err({ kind: "DraftNotRunning" });
  if (!hasFaceUp(draft, seatNumber, sneak, "peekPack", ctx))
    return err(unavailable("no such face-up Whispergear Sneak"));
  if (faceUpWith(draft, seatNumber, "random", ctx).length > 0) {
    return err(unavailable("your face-up Archdemon of Paliano says you can't look at packs"));
  }
  if (!sneakablePacks(draft).includes(packNumber))
    return err(unavailable("someone is looking at that pack"));
  const pack = draft.packs.find((each) => each.packNumber === packNumber);
  if (pack === undefined) return err(unavailable("no such pack"));
  const looked = reveal(turnFaceDown(draft, sneak), {
    at: ctx.now,
    audience: seatNumber,
    seat: seatNumber,
    kind: "peeked",
    cards: pack.cards
      .filter((card) => card.pick === null)
      .map((card) => ({ printingId: card.printingId, finish: card.finish })),
    about: sneak,
  });
  return ok({ ...looked, version: draft.version + 1 });
}

/** Illusionary Informant: turn it face down and see the next card `targetSeat` drafts. */
export function watchPlayer(
  draft: Draft,
  seatNumber: number,
  informant: CardRef,
  targetSeat: number,
  ctx: StepContext,
): Result<Draft, DraftNotRunning | AbilityUnavailable> {
  if (draft.status !== "drafting") return err({ kind: "DraftNotRunning" });
  if (!hasFaceUp(draft, seatNumber, informant, "watchPlayer", ctx)) {
    return err(unavailable("no such face-up Illusionary Informant"));
  }
  if (targetSeat === seatNumber || !draft.seats.some((seat) => seat.seatNumber === targetSeat)) {
    return err(unavailable("choose another player at the table"));
  }
  if (cardAt(draft, informant) === null) return err(unavailable("no such card"));
  const watched = turnFaceDown(draft, informant);
  return ok({
    ...watched,
    watches: [...watched.watches, { watcherSeat: seatNumber, targetSeat, card: informant }],
    version: draft.version + 1,
  });
}
