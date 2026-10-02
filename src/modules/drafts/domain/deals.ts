import { err, ok, type Result } from "@/shared/kernel";
import type { CardRef } from "./abilities";
import { cardAt, reveal, withCard, type Deal, type Draft } from "./draft";
import type { AbilityUnavailable, NothingToAnswer } from "./errors";
import { dealDeadline, type StepContext } from "./steps";

// Deal Broker (design doc 18): "Immediately after the draft, you may reveal a card in your card
// pool. Each other player may offer you one card in their card pool in exchange. You may accept
// any one offer." One broker at a time, in a random order; each step has a deadline (timer on).

const nothing: NothingToAnswer = { kind: "NothingToAnswer" };

/** Whether a card is in a seat's pool right now. */
function inPool(draft: Draft, seatNumber: number, ref: CardRef): boolean {
  const pick = cardAt(draft, ref)?.pick;
  return pick?.poolSeat === seatNumber && (pick.state === "faceDown" || pick.state === "faceUp");
}

/** Moves on to the next broker, or finishes the draft (pools are final, CR 905.1d). */
export function nextDeal(draft: Draft, ctx: StepContext): Draft {
  const [next, ...waiting] = draft.deals?.waiting ?? [];
  if (next === undefined) {
    return {
      ...draft,
      status: "finished",
      finishedAt: ctx.now,
      deals: { current: null, waiting: [] },
    };
  }
  return { ...draft, deals: { current: dealDeadline(draft, next, ctx.now), waiting } };
}

function withDeal(draft: Draft, deal: Deal): Draft {
  return { ...draft, deals: { current: deal, waiting: draft.deals?.waiting ?? [] } };
}

const shown = (draft: Draft, card: CardRef) => {
  const found = cardAt(draft, card);
  return found === null ? [] : [{ printingId: found.printingId, finish: found.finish }];
};

/** The broker reveals a card from their pool, or (null) makes no deal. */
export function revealForDeal(
  draft: Draft,
  seatNumber: number,
  card: CardRef | null,
  ctx: StepContext,
): Result<Draft, NothingToAnswer | AbilityUnavailable> {
  const deal = draft.deals?.current;
  if (
    draft.status !== "dealing" ||
    deal == null ||
    deal.stage !== "reveal" ||
    deal.brokerSeat !== seatNumber
  ) {
    return err(nothing);
  }
  if (card === null) return ok({ ...nextDeal(draft, ctx), version: draft.version + 1 });
  if (!inPool(draft, seatNumber, card)) {
    return err({ kind: "AbilityUnavailable", reason: "that card isn't in your pool" });
  }
  const revealed = reveal(draft, {
    at: ctx.now,
    audience: null,
    seat: seatNumber,
    kind: "dealt",
    cards: shown(draft, card),
    about: deal.brokerCard,
  });
  return ok({
    ...withDeal(
      revealed,
      dealDeadline(draft, { ...deal, stage: "offers", revealed: card, offers: [] }, ctx.now),
    ),
    version: draft.version + 1,
  });
}

/** The seats that may offer: everyone but the broker. */
const offerers = (draft: Draft, deal: Deal) =>
  draft.seats.map((seat) => seat.seatNumber).filter((seat) => seat !== deal.brokerSeat);

/**
 * Another player offers a card from their pool, or (null) nothing. Offers stay hidden until every
 * player has answered; then they're revealed together.
 */
export function offerForDeal(
  draft: Draft,
  seatNumber: number,
  card: CardRef | null,
  ctx: StepContext,
): Result<Draft, NothingToAnswer | AbilityUnavailable> {
  const deal = draft.deals?.current;
  if (
    draft.status !== "dealing" ||
    deal == null ||
    deal.stage !== "offers" ||
    !offerers(draft, deal).includes(seatNumber) ||
    deal.offers.some((offer) => offer.seat === seatNumber)
  ) {
    return err(nothing);
  }
  if (card !== null && !inPool(draft, seatNumber, card)) {
    return err({ kind: "AbilityUnavailable", reason: "that card isn't in your pool" });
  }
  const offers = [...deal.offers, { seat: seatNumber, card }];
  return ok({
    ...closeOffersIfDone(withDeal(draft, { ...deal, offers }), ctx),
    version: draft.version + 1,
  });
}

/** Once everyone has offered, the offers are revealed together and the broker chooses. */
function closeOffersIfDone(draft: Draft, ctx: StepContext): Draft {
  const deal = draft.deals?.current;
  if (deal == null || deal.offers.length < offerers(draft, deal).length) return draft;
  let next = draft;
  for (const offer of deal.offers) {
    if (offer.card === null) continue;
    next = reveal(next, {
      at: ctx.now,
      audience: null,
      seat: offer.seat,
      kind: "dealt",
      cards: shown(draft, offer.card),
      about: deal.brokerCard,
    });
  }
  const anyOffer = deal.offers.some((offer) => offer.card !== null);
  return anyOffer
    ? withDeal(next, dealDeadline(draft, { ...deal, stage: "accept" }, ctx.now))
    : nextDeal(next, ctx);
}

/**
 * The broker accepts one offer (the two cards swap pools, notes and all) or none (null).
 */
export function acceptDeal(
  draft: Draft,
  seatNumber: number,
  offerSeat: number | null,
  ctx: StepContext,
): Result<Draft, NothingToAnswer | AbilityUnavailable> {
  const deal = draft.deals?.current;
  if (
    draft.status !== "dealing" ||
    deal == null ||
    deal.stage !== "accept" ||
    deal.brokerSeat !== seatNumber
  ) {
    return err(nothing);
  }
  if (offerSeat === null) return ok({ ...nextDeal(draft, ctx), version: draft.version + 1 });
  const offer = deal.offers.find((each) => each.seat === offerSeat && each.card !== null);
  if (offer?.card == null || deal.revealed === null) {
    return err({ kind: "AbilityUnavailable", reason: "no such offer" });
  }
  const swapTo = (to: number) => (card: CardRef) => (state: Draft) =>
    withCard(state, card, (each) =>
      each.pick === null ? each : { ...each, pick: { ...each.pick, poolSeat: to } },
    );
  let next = swapTo(offerSeat)(deal.revealed)(draft);
  next = swapTo(seatNumber)(offer.card)(next);
  return ok({ ...nextDeal(next, ctx), version: draft.version + 1 });
}

/** What a bot, or a player who ran out of time, does at a deal step: nothing. */
export function passOnDeal(draft: Draft, seatNumber: number, ctx: StepContext): Draft | null {
  const deal = draft.deals?.current;
  if (draft.status !== "dealing" || deal == null) return null;
  if (deal.stage === "reveal" && deal.brokerSeat === seatNumber) {
    const answered = revealForDeal(draft, seatNumber, null, ctx);
    return answered.ok ? answered.value : null;
  }
  if (deal.stage === "offers" && !deal.offers.some((offer) => offer.seat === seatNumber)) {
    const answered = offerForDeal(draft, seatNumber, null, ctx);
    return answered.ok ? answered.value : null;
  }
  if (deal.stage === "accept" && deal.brokerSeat === seatNumber) {
    const answered = acceptDeal(draft, seatNumber, null, ctx);
    return answered.ok ? answered.value : null;
  }
  return null;
}

/** Who the current deal step is waiting for. */
export function dealWaitsFor(draft: Draft): number[] {
  const deal = draft.deals?.current;
  if (draft.status !== "dealing" || deal == null) return [];
  if (deal.stage === "offers") {
    return offerers(draft, deal).filter(
      (seat) => !deal.offers.some((offer) => offer.seat === seat),
    );
  }
  return [deal.brokerSeat];
}

/** The host ends the deals (timer off, someone has gone): pools are final as they are. */
export function endDeals(draft: Draft, ctx: StepContext): Draft {
  if (draft.status !== "dealing") return draft;
  return {
    ...draft,
    status: "finished",
    finishedAt: ctx.now,
    deals: { current: null, waiting: [] },
    version: draft.version + 1,
  };
}
