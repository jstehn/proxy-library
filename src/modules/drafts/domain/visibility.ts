import type { Color, Finish, PrintingId } from "@/modules/catalog";
import { sameCard, COLORS, type CardRef, type Note } from "./abilities";
import { sneakablePacks } from "./actions";
import {
  cardAt,
  currentPack,
  poolOf,
  refOf,
  seatAt,
  type CardPick,
  type DraftCard,
  type Draft,
  type Reveal,
} from "./draft";
import { dealWaitsFor } from "./deals";
import { abilityOfCard, dredgerSeats, faceUpWith, owedColor, type StepContext } from "./steps";

// Who may see what during a draft (design doc 18, section 4; CR 905.1c and 905.2b–c), in one
// place: a seat's own pack and pile, everyone's face-up cards and notes, and what was revealed
// to everyone or to this seat. Pages show only what this returns.

export type SeenCard = Readonly<{
  ref: CardRef;
  printingId: PrintingId;
  finish: Finish;
  pick: Pick<CardPick, "pickNumber" | "state" | "random" | "auto" | "round"> | null;
  notes: readonly Note[];
}>;

export type SeatSeen = Readonly<{
  seatNumber: number;
  /** Face-up drafted cards: everyone may look at them (905.2c). */
  faceUp: readonly SeenCard[];
  /** Drafted cards with something noted for them: public (905.2b). */
  noted: readonly SeenCard[];
  /** Cards removed from the draft face up (Animus of Predation). */
  removedFaceUp: readonly SeenCard[];
  owesColor: boolean;
}>;

export type PickOptions = Readonly<{
  /** Cogwork Grinder (face down) and Animus of Predation (face up). */
  remove: Readonly<{ faceDown: boolean; faceUp: boolean }>;
  /** Face-up cards that can note the card being drafted. */
  noteWith: ReadonlyArray<
    Readonly<{ ref: CardRef; what: "name" | "types"; creaturesOnly: boolean }>
  >;
  librarians: number;
  operatives: number;
  /** Agent of Acquisitions: only as the first card of a turn. */
  wholePack: boolean;
  /** When several players drafted a Canal Dredger: where this pack's last card may go. */
  lastCardTo: readonly number[];
  sneak: Readonly<{ card: CardRef; packs: readonly number[] }> | null;
  informant: Readonly<{ card: CardRef; targets: readonly number[] }> | null;
}>;

export type YouSeen = Readonly<{
  seatNumber: number;
  /** The pack in front of you. `cards` is null while you must draft at random (Archdemon). */
  pack: Readonly<{ packNumber: number; count: number; cards: readonly SeenCard[] | null }> | null;
  atRandom: boolean;
  /** A card you drew at random, waiting for your choices about it. */
  awaiting: SeenCard | null;
  /** Still drafting from this pack: extra cards owed, or the whole pack (Agent). */
  turn: Readonly<{ extraCards: number; wholePack: boolean }> | null;
  skipPacks: number;
  lockedOut: boolean;
  colorPrompt: Readonly<{
    card: SeenCard;
    chosen: readonly Color[];
    open: readonly Color[];
  }> | null;
  /** Everything you've drafted, wherever it is now (removed, put back), in order. */
  pile: readonly SeenCard[];
  pool: readonly SeenCard[];
  options: PickOptions;
}>;

export type DealSeen = Readonly<{
  brokerSeat: number;
  brokerCard: SeenCard | null;
  stage: "reveal" | "offers" | "accept";
  revealed: SeenCard | null;
  /** Offers are shown once everyone has answered; before that, only your own. */
  offers: ReadonlyArray<Readonly<{ seat: number; card: SeenCard | null }>>;
  waitingFor: readonly number[];
  deadline: Date | null;
}>;

export type DraftSeen = Readonly<{
  seats: readonly SeatSeen[];
  reveals: readonly Reveal[];
  you: YouSeen | null;
  deal: DealSeen | null;
}>;

function seen(draft: Draft, ref: CardRef): SeenCard | null {
  const card = cardAt(draft, ref);
  return card === null ? null : seenCard(ref, card);
}

function seenCard(ref: CardRef, card: DraftCard): SeenCard {
  return {
    ref,
    printingId: card.printingId,
    finish: card.finish,
    pick:
      card.pick === null
        ? null
        : {
            pickNumber: card.pick.pickNumber,
            state: card.pick.state,
            random: card.pick.random,
            auto: card.pick.auto,
            round: card.pick.round,
          },
    notes: card.pick?.notes ?? [],
  };
}

function piled(draft: Draft, seatNumber: number): SeenCard[] {
  return draft.packs
    .flatMap((pack) =>
      pack.cards
        .filter((card) => card.pick?.seat === seatNumber)
        .map((card) => seenCard(refOf(pack, card), card)),
    )
    .sort((a, b) => (a.pick?.pickNumber ?? 0) - (b.pick?.pickNumber ?? 0));
}

function optionsFor(draft: Draft, seatNumber: number, ctx: StepContext): PickOptions {
  const seat = seatAt(draft, seatNumber);
  const turn = seat.abilities.turn;
  const kindOf = (ref: CardRef) => {
    const card = cardAt(draft, ref);
    return card === null ? null : (abilityOfCard(ctx, card)?.ability ?? null);
  };
  const removers = faceUpWith(draft, seatNumber, "remove", ctx).map(kindOf);
  const extras = faceUpWith(draft, seatNumber, "extraCard", ctx).filter(
    (ref) =>
      !(turn?.librarians ?? []).some((used) => sameCard(used, ref)) &&
      !(turn?.operatives ?? []).some((used) => sameCard(used, ref)),
  );
  const countExtras = (then: "intoPack" | "skipPack") =>
    extras.filter((ref) => {
      const kind = kindOf(ref);
      return kind?.kind === "extraCard" && kind.then === then;
    }).length;
  const dredgers = dredgerSeats(draft, ctx);
  const sneak = faceUpWith(draft, seatNumber, "peekPack", ctx)[0];
  const informant = faceUpWith(draft, seatNumber, "watchPlayer", ctx)[0];
  return {
    remove: {
      faceDown: removers.some((kind) => kind?.kind === "remove" && !kind.faceUp),
      faceUp: removers.some((kind) => kind?.kind === "remove" && kind.faceUp),
    },
    noteWith: faceUpWith(draft, seatNumber, "noteDrafted", ctx).flatMap((ref) => {
      const kind = kindOf(ref);
      return kind?.kind === "noteDrafted"
        ? [{ ref, what: kind.what, creaturesOnly: kind.creaturesOnly }]
        : [];
    }),
    librarians: turn?.agent ? 0 : countExtras("intoPack"),
    operatives: turn?.agent ? 0 : countExtras("skipPack"),
    wholePack: turn === null && faceUpWith(draft, seatNumber, "wholePack", ctx).length > 0,
    lastCardTo: dredgers.length > 1 ? dredgers : [],
    sneak: sneak === undefined ? null : { card: sneak, packs: sneakablePacks(draft) },
    informant:
      informant === undefined
        ? null
        : {
            card: informant,
            targets: draft.seats
              .map((each) => each.seatNumber)
              .filter((each) => each !== seatNumber),
          },
  };
}

function dealSeen(draft: Draft, viewer: number | null): DealSeen | null {
  const deal = draft.deals?.current;
  if (draft.status !== "dealing" || deal == null) return null;
  const allIn = deal.stage === "accept";
  return {
    brokerSeat: deal.brokerSeat,
    brokerCard: seen(draft, deal.brokerCard),
    stage: deal.stage,
    revealed: deal.revealed === null ? null : seen(draft, deal.revealed),
    offers: deal.offers
      .filter((offer) => allIn || offer.seat === viewer)
      .map((offer) => ({
        seat: offer.seat,
        card: offer.card === null ? null : seen(draft, offer.card),
      })),
    waitingFor: dealWaitsFor(draft),
    deadline: deal.deadline,
  };
}

/** The draft as `viewer` may see it (null: someone not seated, watching). */
export function visibleTo(draft: Draft, viewer: number | null, ctx: StepContext): DraftSeen {
  const seats = draft.seats.map((seat): SeatSeen => {
    const pile = piled(draft, seat.seatNumber);
    return {
      seatNumber: seat.seatNumber,
      faceUp: pile.filter((card) => card.pick?.state === "faceUp"),
      noted: pile.filter((card) => card.notes.length > 0),
      removedFaceUp: pile.filter((card) => card.pick?.state === "removedFaceUp"),
      owesColor: owedColor(draft, seat.seatNumber) !== null,
    };
  });
  const reveals = draft.reveals.filter(
    (each) => each.audience === null || each.audience === viewer,
  );
  if (viewer === null || !draft.seats.some((seat) => seat.seatNumber === viewer)) {
    return { seats, reveals, you: null, deal: dealSeen(draft, null) };
  }

  const seat = seatAt(draft, viewer);
  const front = currentPack(draft, viewer);
  const atRandom = faceUpWith(draft, viewer, "random", ctx).length > 0;
  const left = front?.cards.filter((card) => card.pick === null) ?? [];
  const owed = owedColor(draft, viewer);
  const owedCard = owed === null ? null : seen(draft, owed.card);
  const pool = poolOf(draft, viewer).flatMap((card) => {
    const pack = draft.packs.find((each) => each.cards.includes(card));
    return pack === undefined ? [] : [seenCard(refOf(pack, card), card)];
  });
  return {
    seats,
    reveals,
    you: {
      seatNumber: viewer,
      pack:
        front === null || seat.abilities.awaitingChoices !== null
          ? null
          : {
              packNumber: front.packNumber,
              count: left.length,
              // CR 905.1c and Archdemon of Paliano: you can't look at the pack while it's face up.
              cards: atRandom ? null : left.map((card) => seenCard(refOf(front, card), card)),
            },
      atRandom,
      awaiting:
        seat.abilities.awaitingChoices === null
          ? null
          : seen(draft, seat.abilities.awaitingChoices),
      turn:
        seat.abilities.turn === null
          ? null
          : {
              extraCards: seat.abilities.turn.extraCards,
              wholePack: seat.abilities.turn.agent !== null,
            },
      skipPacks: seat.abilities.skipPacks,
      lockedOut: seat.abilities.lockedOutRound === draft.round,
      colorPrompt:
        owed === null || owedCard === null
          ? null
          : {
              card: owedCard,
              chosen: owed.note.colors,
              open: COLORS.filter((color) => !owed.note.colors.includes(color)),
            },
      pile: piled(draft, viewer),
      pool,
      options: optionsFor(draft, viewer, ctx),
    },
    deal: dealSeen(draft, viewer),
  };
}
