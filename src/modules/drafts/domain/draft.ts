import type { Finish, PrintingId, SetCode } from "@/modules/catalog";
import { Cents, err, ok, type Brand, type Result, type UserId } from "@/shared/kernel";
import type {
  BotNotFound,
  BotsForAdminsOnly,
  DraftFull,
  DraftNotOpen,
  DraftNotRunning,
  NotHost,
  NotSeated,
  SeatsInvalid,
  StalePick,
  TimerInvalid,
  TooFewPlayers,
} from "./errors";
import type { CardRef, Note } from "./abilities";
import { DRAFT_STYLES, passTarget, type DraftStyleName } from "./style";

// A live booster draft (design doc 17). The whole table is one aggregate: at most 8 seats × 3
// packs × ~15 cards, small enough to load, change with pure functions, and save in one go.

export type DraftId = Brand<number, "DraftId">;
export const DraftId = {
  of(raw: number): DraftId {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new RangeError(`not a draft id: ${raw}`);
    return raw as DraftId;
  },
};

/** "dealing": the packs are done, and Deal Broker exchanges happen before pools are final. */
export type DraftStatus = "lobby" | "drafting" | "dealing" | "finished" | "cancelled";

export type PickTimer =
  Readonly<{ kind: "off" }> | Readonly<{ kind: "on"; secondsPerPick: number }>;

/** Where a seat's packs come from. Only the entry fee today; bringing your own packs comes later. */
export type PackSource = Readonly<{ kind: "entryFee" }>;

export type Seat = Readonly<{
  /**
   * The player in the seat; for a bot, the admin who added it, who paid its fee and gets the
   * cards it picks (design doc 17, section 16).
   */
  userId: UserId;
  /** 1, 2, … for bots (shown as "Bot 1"), null for a person. */
  botNumber: number | null;
  /** Join order in the lobby; 0…n-1 around the table once the draft starts. */
  seatNumber: number;
  feePaid: Cents;
  joinedAt: Date;
  packSource: PackSource;
  /** When the current pick times out (timer on and a pack waiting), else null. */
  deadline: Date | null;
  /** The pack that deadline belongs to, so a new pack gets a fresh deadline. */
  deadlinePack: number | null;
  graceUsedSeconds: number;
  /** When the seat's browser was last in touch, or null once it has gone (section 7). */
  lastSeenAt: Date | null;
  /** How many cards the seat had drafted when its deadline was set (a new card, a new deadline). */
  deadlinePick: number | null;
  /** When a color the seat owes (Paliano, Regicide) is chosen for it, if the timer is on. */
  promptDeadline: Date | null;
  abilities: SeatAbilities;
}>;

/**
 * A turn with one pack that goes on for more than one card (design doc 18, section 7): extra
 * cards owed to Librarians or Operatives, or the whole pack (Agent of Acquisitions).
 */
export type Turn = Readonly<{
  packNumber: number;
  extraCards: number;
  librarians: readonly CardRef[];
  operatives: readonly CardRef[];
  agent: CardRef | null;
}>;

/** Draft-ability state of one seat. */
export type SeatAbilities = Readonly<{
  /** Packs to pass on without drafting (Leovold's Operative). */
  skipPacks: number;
  /** The round in which the seat may draft no more cards (Agent of Acquisitions). */
  lockedOutRound: number | null;
  turn: Turn | null;
  /** Aether Searchers waiting to note the next card this seat drafts. */
  armedSearchers: readonly CardRef[];
  /** A card drafted at random (Archdemon), waiting for the seat's choices about it. */
  awaitingChoices: CardRef | null;
}>;

export const NO_ABILITIES: SeatAbilities = {
  skipPacks: 0,
  lockedOutRound: null,
  turn: null,
  armedSearchers: [],
  awaitingChoices: null,
};

/**
 * Where a drafted card is: in the drafter's pile face down or face up (CR 905.2c), removed from
 * the draft (Grinder face down, Animus face up), or put back into a pack (Cogwork Librarian).
 */
export type PickState = "faceDown" | "faceUp" | "removedFaceDown" | "removedFaceUp" | "returned";

export type CardPick = Readonly<{
  seat: number;
  pickNumber: number;
  auto: boolean;
  at: Date;
  /** The round it was drafted in ("cards drafted this draft round"). */
  round: number;
  /** Drafted at random, without looking (Archdemon of Paliano). */
  random: boolean;
  state: PickState;
  /** Whose card pool it's in: its drafter's, unless a Deal Broker exchange moved it. */
  poolSeat: number;
  notes: readonly Note[];
}>;

export type DraftCard = Readonly<{
  slot: number; // position in the pack as it was opened (or added, for a Librarian put back)
  printingId: PrintingId;
  finish: Finish;
  pick: CardPick | null;
  /** A Cogwork Librarian put into this pack: the card it was before. */
  cameFrom: CardRef | null;
}>;

/** Someone waiting to see the next card drafted from a pack. */
export type PackWatcher = Readonly<{ kind: "spy" | "guess"; seat: number; card: CardRef }>;

/** Illusionary Informant: `watcherSeat` sees the next card `targetSeat` drafts. */
export type PlayerWatch = Readonly<{ watcherSeat: number; targetSeat: number; card: CardRef }>;

/** Something shown during the draft, to everyone (`audience` null) or to one seat. */
export type Reveal = Readonly<{
  at: Date;
  audience: number | null;
  /** The seat whose action showed it. */
  seat: number;
  kind:
    | "revealed" // a "reveal as you draft" card, or a card revealed to note it
    | "removed" // removed from the draft face up (Animus)
    | "guessed" // the card a Spire Phantasm's guess was about
    | "spied" // Cogwork Spy
    | "informed" // Illusionary Informant
    | "peeked" // Whispergear Sneak
    | "passedOn" // a pack passed on without drafting, which the seat may look at
    | "dealt"; // Deal Broker: a card revealed or offered
  cards: ReadonlyArray<Readonly<{ printingId: PrintingId; finish: Finish }>>;
  /** The card whose ability caused it, if any. */
  about: CardRef | null;
}>;

/** One Deal Broker exchange after the draft (design doc 18). */
export type Deal = Readonly<{
  brokerSeat: number;
  brokerCard: CardRef;
  stage: "reveal" | "offers" | "accept";
  revealed: CardRef | null;
  /** One per other seat once it has answered: a card, or null for no offer. */
  offers: ReadonlyArray<Readonly<{ seat: number; card: CardRef | null }>>;
  deadline: Date | null;
}>;

export type Deals = Readonly<{ current: Deal | null; waiting: readonly Deal[] }>;

export type DraftPack = Readonly<{
  packNumber: number;
  round: number;
  openedBySeat: number;
  seed: string;
  /** Whose queue the pack is in. */
  holderSeat: number;
  /** Arrival order: the lowest number in a seat's queue is the pack in front. */
  queuePosition: number;
  cards: readonly DraftCard[];
  /** The seat that last passed it on (Cogwork Tracker), null if nobody has yet. */
  lastPassedBy: number | null;
  /** The seat that added it with a Lore Seeker, or null for a pack opened at a round's start. */
  addedBy: number | null;
  watchers: readonly PackWatcher[];
}>;

export type Draft = Readonly<{
  id: DraftId;
  hostId: UserId;
  setCode: SetCode;
  boosterType: string;
  style: DraftStyleName;
  status: DraftStatus;
  maxSeats: number;
  timer: PickTimer;
  /** What each seat pays to join, fixed when the draft is created. */
  entryFee: Cents;
  /** 0 in the lobby, then 1…packsPerPlayer. */
  round: number;
  /** The next queue position to hand out. */
  sequence: number;
  seats: readonly Seat[];
  packs: readonly DraftPack[];
  /** The basic lands taken out of the packs at the start and dealt to the players (rule 15). */
  basicsHandedOut: readonly HandedOutBasic[];
  watches: readonly PlayerWatch[];
  /** Everything shown during the draft, oldest first. */
  reveals: readonly Reveal[];
  deals: Deals | null;
  /** Goes up with every change that browsers should see (ADR 0018). */
  version: number;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}>;

/** One basic land from the packs, and the player it was dealt to. */
export type HandedOutBasic = Readonly<{ userId: UserId; printingId: PrintingId; finish: Finish }>;

/** A draft about to be created: everything except what the database assigns. */
export type NewDraft = Omit<Draft, "id">;

export const MIN_SEATS = 2;
export const MAX_SEATS = 8;
export const MIN_PICK_SECONDS = 30;
export const MAX_PICK_SECONDS = 300;
export const DEFAULT_PICK_SECONDS = 90;

export function checkSeats(maxSeats: number): Result<number, SeatsInvalid> {
  if (!Number.isInteger(maxSeats) || maxSeats < MIN_SEATS || maxSeats > MAX_SEATS) {
    return err({ kind: "SeatsInvalid", minimum: MIN_SEATS, maximum: MAX_SEATS });
  }
  return ok(maxSeats);
}

/** Seconds per pick, or null for no timer. */
export function checkTimer(secondsPerPick: number | null): Result<PickTimer, TimerInvalid> {
  if (secondsPerPick === null) return ok({ kind: "off" });
  if (
    !Number.isInteger(secondsPerPick) ||
    secondsPerPick < MIN_PICK_SECONDS ||
    secondsPerPick > MAX_PICK_SECONDS
  ) {
    return err({ kind: "TimerInvalid", minimum: MIN_PICK_SECONDS, maximum: MAX_PICK_SECONDS });
  }
  return ok({ kind: "on", secondsPerPick });
}

function newSeat(
  userId: UserId,
  seatNumber: number,
  fee: Cents,
  now: Date,
  botNumber: number | null = null,
): Seat {
  return {
    userId,
    botNumber,
    seatNumber,
    feePaid: fee,
    joinedAt: now,
    packSource: { kind: "entryFee" },
    deadline: null,
    deadlinePack: null,
    deadlinePick: null,
    promptDeadline: null,
    graceUsedSeconds: 0,
    lastSeenAt: null,
    abilities: NO_ABILITIES,
  };
}

/** A new lobby with the host already seated (they paid the fee too). */
export function newDraft(input: {
  hostId: UserId;
  setCode: SetCode;
  boosterType: string;
  maxSeats: number;
  timer: PickTimer;
  entryFee: Cents;
  now: Date;
}): NewDraft {
  return {
    hostId: input.hostId,
    setCode: input.setCode,
    boosterType: input.boosterType,
    style: "booster",
    status: "lobby",
    maxSeats: input.maxSeats,
    timer: input.timer,
    entryFee: input.entryFee,
    round: 0,
    sequence: 0,
    seats: [newSeat(input.hostId, 0, input.entryFee, input.now)],
    packs: [],
    basicsHandedOut: [],
    watches: [],
    reveals: [],
    deals: null,
    version: 1,
    createdAt: input.now,
    startedAt: null,
    finishedAt: null,
  };
}

/** The seat a person sits in (never one of their bots), or null. */
export function seatOf(draft: Draft, userId: UserId): Seat | null {
  return draft.seats.find((seat) => seat.userId === userId && seat.botNumber === null) ?? null;
}

export const isBot = (seat: Pick<Seat, "botNumber">) => seat.botNumber !== null;

/** The draft with one seat replaced (seat numbers are unique, unlike user ids: bots share theirs). */
export function withSeat(draft: Draft, seat: Seat): Draft {
  return {
    ...draft,
    seats: draft.seats.map((each) => (each.seatNumber === seat.seatNumber ? seat : each)),
  };
}

const nextSeatNumber = (draft: Draft) =>
  Math.max(-1, ...draft.seats.map((seat) => seat.seatNumber)) + 1;

/** Whether a draft still holds its players (rule 1: one unfinished draft per player). */
export function isUnfinished(draft: Pick<Draft, "status">): boolean {
  return draft.status === "lobby" || draft.status === "drafting" || draft.status === "dealing";
}

/** A player takes a seat. The caller has charged them `draft.entryFee`. */
export function joinDraft(
  draft: Draft,
  userId: UserId,
  now: Date,
): Result<Draft, DraftNotOpen | DraftFull> {
  if (draft.status !== "lobby") return err({ kind: "DraftNotOpen" });
  if (seatOf(draft, userId) !== null) return ok(draft); // already here: nothing to do
  if (draft.seats.length >= draft.maxSeats) {
    return err({ kind: "DraftFull", maxSeats: draft.maxSeats });
  }
  return ok({
    ...draft,
    seats: [...draft.seats, newSeat(userId, nextSeatNumber(draft), draft.entryFee, now)],
    version: draft.version + 1,
  });
}

/** Money to give back when a lobby shrinks or closes (rule 2). */
export type Refund = Readonly<{ userId: UserId; amount: Cents }>;

/**
 * A player leaves a lobby and gets their fee back. When the host leaves, the lobby closes and
 * everyone is refunded.
 */
export function leaveDraft(
  draft: Draft,
  userId: UserId,
): Result<{ draft: Draft; refunds: Refund[] }, DraftNotOpen | NotSeated> {
  const seat = seatOf(draft, userId);
  if (seat === null) return err({ kind: "NotSeated" });
  if (draft.status !== "lobby") return err({ kind: "DraftNotOpen" });
  if (userId === draft.hostId) {
    // One refund per person: the host's covers their own seat and their bots'.
    const totals = new Map<UserId, Cents>();
    for (const each of draft.seats) {
      totals.set(each.userId, Cents.add(totals.get(each.userId) ?? Cents.zero, each.feePaid));
    }
    const refunds = [...totals].map(([payer, amount]) => ({ userId: payer, amount }));
    return ok({ draft: { ...draft, status: "cancelled", version: draft.version + 1 }, refunds });
  }
  return ok({
    draft: {
      ...draft,
      seats: draft.seats.filter((each) => each.seatNumber !== seat.seatNumber),
      version: draft.version + 1,
    },
    refunds: [{ userId, amount: seat.feePaid }],
  });
}

/**
 * An admin hosting a lobby adds a bot to an empty seat (rule 16). The caller has charged the host
 * `draft.entryFee` for it.
 */
export function addBot(
  draft: Draft,
  actor: Readonly<{ userId: UserId; isAdmin: boolean }>,
  now: Date,
): Result<Draft, BotsForAdminsOnly | NotHost | DraftNotOpen | DraftFull> {
  if (!actor.isAdmin) return err({ kind: "BotsForAdminsOnly" });
  if (actor.userId !== draft.hostId) return err({ kind: "NotHost" });
  if (draft.status !== "lobby") return err({ kind: "DraftNotOpen" });
  if (draft.seats.length >= draft.maxSeats) {
    return err({ kind: "DraftFull", maxSeats: draft.maxSeats });
  }
  const botNumber = Math.max(0, ...draft.seats.map((seat) => seat.botNumber ?? 0)) + 1;
  const bot = newSeat(draft.hostId, nextSeatNumber(draft), draft.entryFee, now, botNumber);
  return ok({ ...draft, seats: [...draft.seats, bot], version: draft.version + 1 });
}

/** The host takes a bot out of the lobby, and gets its fee back. */
export function removeBot(
  draft: Draft,
  userId: UserId,
  botNumber: number,
): Result<{ draft: Draft; refund: Refund }, NotHost | DraftNotOpen | BotNotFound> {
  if (userId !== draft.hostId) return err({ kind: "NotHost" });
  if (draft.status !== "lobby") return err({ kind: "DraftNotOpen" });
  const bot = draft.seats.find((seat) => seat.botNumber === botNumber);
  if (bot === undefined) return err({ kind: "BotNotFound" });
  return ok({
    draft: {
      ...draft,
      seats: draft.seats.filter((seat) => seat.seatNumber !== bot.seatNumber),
      version: draft.version + 1,
    },
    refund: { userId: bot.userId, amount: bot.feePaid },
  });
}

/** Rule 3: only the host starts the draft, and only with enough players. */
export function checkCanStart(
  draft: Draft,
  userId: UserId,
): Result<Draft, NotHost | DraftNotOpen | TooFewPlayers> {
  if (userId !== draft.hostId) return err({ kind: "NotHost" });
  if (draft.status !== "lobby") return err({ kind: "DraftNotOpen" });
  if (draft.seats.length < MIN_SEATS) return err({ kind: "TooFewPlayers", minimum: MIN_SEATS });
  return ok(draft);
}

/** The seats around the table, in join order (seat 0 first once started). */
export function seatsInOrder(draft: Pick<Draft, "seats">): Seat[] {
  return [...draft.seats].sort(
    (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.seatNumber - b.seatNumber,
  );
}

/** One opened booster, before it joins the table. */
export type OpenedPack = Readonly<{
  seed: string;
  cards: ReadonlyArray<{ printingId: PrintingId; finish: Finish }>;
}>;

/**
 * Starts the draft (rule 4). `opened[seat][round - 1]` is the pack that seat opens in that round,
 * with seats in `seatsInOrder` order, already without its basic lands; `handedOut` is where those
 * basics went (rule 15, `dealBasics`). The caller has already passed `checkCanStart`.
 */
export function startDraft(
  draft: Draft,
  opened: ReadonlyArray<ReadonlyArray<OpenedPack>>,
  now: Date,
  handedOut: readonly HandedOutBasic[] = [],
): Draft {
  const style = DRAFT_STYLES[draft.style];
  const seats = seatsInOrder(draft).map((seat, index) => ({ ...seat, seatNumber: index }));
  if (opened.length !== seats.length || opened.some((row) => row.length !== style.packsPerPlayer)) {
    throw new RangeError("startDraft needs one opened pack per seat per round");
  }

  const packs: DraftPack[] = [];
  for (let round = 1; round <= style.packsPerPlayer; round += 1) {
    seats.forEach((seat, seatIndex) => {
      packs.push(
        newPack(opened[seatIndex][round - 1], {
          packNumber: (round - 1) * seats.length + seatIndex,
          round,
          seat: seat.seatNumber,
          queuePosition: -1, // handed out when its round begins
          addedBy: null,
        }),
      );
    });
  }

  let started: Draft = beginRound(
    {
      ...draft,
      status: "drafting",
      seats,
      packs,
      basicsHandedOut: handedOut,
      startedAt: now,
      version: draft.version + 1,
    },
    1,
  );
  // Packs that came out empty: move on to a round with cards in it (nobody has drafted yet, so
  // there's nothing for a Deal Broker to do at the end).
  while (roundIsOver(started)) {
    started = isLastRound(started)
      ? { ...started, status: "finished", finishedAt: now }
      : beginRound(started, started.round + 1);
    if (started.status === "finished") break;
  }
  return refreshDeadlines(started, now);
}

/** An opened booster as a pack at the table. */
export function newPack(
  opened: OpenedPack,
  where: {
    packNumber: number;
    round: number;
    seat: number;
    queuePosition: number;
    addedBy: number | null;
  },
): DraftPack {
  return {
    packNumber: where.packNumber,
    round: where.round,
    openedBySeat: where.seat,
    seed: opened.seed,
    holderSeat: where.seat,
    queuePosition: where.queuePosition,
    cards: opened.cards.map((card, slot) => ({ ...card, slot, pick: null, cameFrom: null })),
    lastPassedBy: null,
    addedBy: where.addedBy,
    watchers: [],
  };
}

export const cardsLeft = (pack: DraftPack) =>
  pack.cards.filter((card) => card.pick === null).length;

/** Puts a round's packs in front of the players who opened them. */
export function beginRound(draft: Draft, round: number): Draft {
  let sequence = draft.sequence;
  const packs = draft.packs.map((pack) =>
    pack.round === round ? { ...pack, queuePosition: sequence++ } : pack,
  );
  return { ...draft, round, sequence, packs };
}

export const isLastRound = (draft: Draft) =>
  draft.round >= DRAFT_STYLES[draft.style].packsPerPlayer;

/**
 * Rule 7: a round is over when its packs are empty and nobody is still in the middle of a turn
 * (extra cards owed, a random card waiting for choices).
 */
export function roundIsOver(draft: Draft): boolean {
  return (
    draft.packs.every((pack) => pack.round !== draft.round || cardsLeft(pack) === 0) &&
    draft.seats.every(
      (seat) => seat.abilities.turn === null && seat.abilities.awaitingChoices === null,
    )
  );
}

/** The packs waiting for a seat this round, front of the queue first. */
export function queueOf(draft: Draft, seatNumber: number): DraftPack[] {
  if (draft.status !== "drafting") return [];
  const held = draft.seats.find((seat) => seat.seatNumber === seatNumber)?.abilities.turn;
  return draft.packs
    .filter(
      (pack) => pack.round === draft.round && pack.holderSeat === seatNumber && cardsLeft(pack) > 0,
    )
    .sort(
      // A pack the seat is in the middle of a turn with stays in front.
      (a, b) =>
        Number(b.packNumber === held?.packNumber) - Number(a.packNumber === held?.packNumber) ||
        a.queuePosition - b.queuePosition,
    );
}

/** The pack a seat picks from now, or null while it waits for its neighbour. */
export function currentPack(draft: Draft, seatNumber: number): DraftPack | null {
  return queueOf(draft, seatNumber)[0] ?? null;
}

export const allCards = (draft: Draft) =>
  draft.packs.flatMap((pack) => pack.cards.map((card) => ({ pack, card })));

export const refOf = (pack: DraftPack, card: DraftCard): CardRef => ({
  packNumber: pack.packNumber,
  slot: card.slot,
});

export function cardAt(draft: Draft, ref: CardRef): DraftCard | null {
  const pack = draft.packs.find((each) => each.packNumber === ref.packNumber);
  return pack?.cards.find((card) => card.slot === ref.slot) ?? null;
}

/**
 * A seat's card pool: the cards in its drafted pile (face down or face up), counting any a Deal
 * Broker exchange brought in, in pick order. Removed cards and Librarians put back aren't in it.
 */
export function poolOf(draft: Draft, seatNumber: number): DraftCard[] {
  return draft.packs
    .flatMap((pack) => pack.cards)
    .filter(
      (card) =>
        card.pick?.poolSeat === seatNumber &&
        (card.pick.state === "faceDown" || card.pick.state === "faceUp"),
    )
    .sort((a, b) => (a.pick?.pickNumber ?? 0) - (b.pick?.pickNumber ?? 0));
}

/** Every card a seat has drafted, wherever it is now, in order. */
export function draftedBy(draft: Draft, seatNumber: number): DraftCard[] {
  return draft.packs
    .flatMap((pack) => pack.cards)
    .filter((card) => card.pick?.seat === seatNumber)
    .sort((a, b) => (a.pick?.pickNumber ?? 0) - (b.pick?.pickNumber ?? 0));
}

/** The draft with one card replaced. */
export function withCard(
  draft: Draft,
  ref: CardRef,
  change: (card: DraftCard) => DraftCard,
): Draft {
  return {
    ...draft,
    packs: draft.packs.map((pack) =>
      pack.packNumber !== ref.packNumber
        ? pack
        : {
            ...pack,
            cards: pack.cards.map((card) => (card.slot === ref.slot ? change(card) : card)),
          },
    ),
  };
}

export function withPack(
  draft: Draft,
  packNumber: number,
  change: (pack: DraftPack) => DraftPack,
): Draft {
  return {
    ...draft,
    packs: draft.packs.map((pack) => (pack.packNumber === packNumber ? change(pack) : pack)),
  };
}

export function seatAt(draft: Draft, seatNumber: number): Seat {
  const seat = draft.seats.find((each) => each.seatNumber === seatNumber);
  if (seat === undefined) throw new Error(`no seat ${seatNumber} at this table`);
  return seat;
}

export function withAbilities(
  draft: Draft,
  seatNumber: number,
  change: (abilities: SeatAbilities) => SeatAbilities,
): Draft {
  const seat = seatAt(draft, seatNumber);
  return withSeat(draft, { ...seat, abilities: change(seat.abilities) });
}

export const reveal = (draft: Draft, shown: Reveal): Draft => ({
  ...draft,
  reveals: [...draft.reveals, shown],
});

/**
 * Rule 9: a seat's deadline starts when a pack reaches the front of its queue, and starts again
 * with every card it drafts. No pack, no timer, or no running draft: no deadline. A seat that
 * owes a color choice gets a deadline for that too.
 */
export function refreshDeadlines(
  draft: Draft,
  now: Date,
  owesPrompt: (draft: Draft, seatNumber: number) => boolean = () => false,
): Draft {
  const timer = draft.timer;
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);
  const seats = draft.seats.map((seat): Seat => {
    const front = currentPack(draft, seat.seatNumber);
    const picks = draftedBy(draft, seat.seatNumber).length;
    const owes = draft.status === "drafting" && owesPrompt(draft, seat.seatNumber);
    let next: Seat = seat;
    // Bots act the moment they can, so they never wait on a timer.
    if (timer.kind === "off" || seat.botNumber !== null) {
      next = {
        ...next,
        deadline: null,
        deadlinePack: null,
        deadlinePick: null,
        promptDeadline: null,
      };
    } else {
      if (front === null && seat.abilities.awaitingChoices === null) {
        next = { ...next, deadline: null, deadlinePack: null, deadlinePick: null };
      } else if (seat.deadlinePack !== (front?.packNumber ?? -1) || seat.deadlinePick !== picks) {
        next = {
          ...next,
          deadline: later(timer.secondsPerPick),
          deadlinePack: front?.packNumber ?? -1,
          deadlinePick: picks,
        };
      }
      if (!owes) next = { ...next, promptDeadline: null };
      else if (seat.promptDeadline === null)
        next = { ...next, promptDeadline: later(timer.secondsPerPick) };
    }
    const unchanged =
      next.deadline === seat.deadline &&
      next.deadlinePack === seat.deadlinePack &&
      next.deadlinePick === seat.deadlinePick &&
      next.promptDeadline === seat.promptDeadline;
    return unchanged ? seat : next;
  });
  return { ...draft, seats };
}
