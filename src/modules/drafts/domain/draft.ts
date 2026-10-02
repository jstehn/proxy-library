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

export type DraftStatus = "lobby" | "drafting" | "finished" | "cancelled";

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
}>;

export type CardPick = Readonly<{ seat: number; pickNumber: number; auto: boolean; at: Date }>;

export type DraftCard = Readonly<{
  slot: number; // position in the pack as it was opened
  printingId: PrintingId;
  finish: Finish;
  pick: CardPick | null;
}>;

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
    graceUsedSeconds: 0,
    lastSeenAt: null,
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
  return draft.status === "lobby" || draft.status === "drafting";
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
      const pack = opened[seatIndex][round - 1];
      packs.push({
        packNumber: (round - 1) * seats.length + seatIndex,
        round,
        openedBySeat: seat.seatNumber,
        seed: pack.seed,
        holderSeat: seat.seatNumber,
        queuePosition: -1, // handed out when its round begins
        cards: pack.cards.map((card, slot) => ({ ...card, slot, pick: null })),
      });
    });
  }

  const started: Draft = {
    ...draft,
    status: "drafting",
    seats,
    packs,
    basicsHandedOut: handedOut,
    startedAt: now,
    version: draft.version + 1,
  };
  return refreshDeadlines(beginRound(started, 1, now), now);
}

const cardsLeft = (pack: DraftPack) => pack.cards.filter((card) => card.pick === null).length;

/**
 * Puts a round's packs in front of the players who opened them. Packs that came out of the
 * booster empty (a recipe with nothing on its sheets) are skipped; a round with no cards at all
 * moves straight on.
 */
function beginRound(draft: Draft, round: number, now: Date): Draft {
  let sequence = draft.sequence;
  const packs = draft.packs.map((pack) =>
    pack.round === round ? { ...pack, queuePosition: sequence++ } : pack,
  );
  const next: Draft = { ...draft, round, sequence, packs };
  return roundIsOver(next) ? endRound(next, now) : next;
}

function roundIsOver(draft: Draft): boolean {
  return draft.packs.every((pack) => pack.round !== draft.round || cardsLeft(pack) === 0);
}

/** Rule 7: the next round, or the end of the draft. */
function endRound(draft: Draft, now: Date): Draft {
  if (draft.round < DRAFT_STYLES[draft.style].packsPerPlayer) {
    return beginRound(draft, draft.round + 1, now);
  }
  return { ...draft, status: "finished", finishedAt: now };
}

/** The packs waiting for a seat this round, front of the queue first. */
export function queueOf(draft: Draft, seatNumber: number): DraftPack[] {
  if (draft.status !== "drafting") return [];
  return draft.packs
    .filter(
      (pack) => pack.round === draft.round && pack.holderSeat === seatNumber && cardsLeft(pack) > 0,
    )
    .sort((a, b) => a.queuePosition - b.queuePosition);
}

/** The pack a seat picks from now, or null while it waits for its neighbour. */
export function currentPack(draft: Draft, seatNumber: number): DraftPack | null {
  return queueOf(draft, seatNumber)[0] ?? null;
}

/** Every card a seat has picked, in pick order. */
export function poolOf(draft: Draft, seatNumber: number): DraftCard[] {
  return draft.packs
    .flatMap((pack) => pack.cards)
    .filter((card) => card.pick?.seat === seatNumber)
    .sort((a, b) => (a.pick?.pickNumber ?? 0) - (b.pick?.pickNumber ?? 0));
}

export type PickInput = Readonly<{
  seatNumber: number;
  packNumber: number;
  slot: number;
  auto: boolean;
}>;

/**
 * A seat takes one card from the pack in front of it (rules 5–7). The rest of the pack goes to
 * the back of the next seat's queue; an emptied round starts the next one or ends the draft.
 */
export function applyPick(
  draft: Draft,
  input: PickInput,
  now: Date,
): Result<{ draft: Draft; card: DraftCard }, DraftNotRunning | StalePick> {
  if (draft.status !== "drafting") return err({ kind: "DraftNotRunning" });
  const pack = currentPack(draft, input.seatNumber);
  if (pack === null || pack.packNumber !== input.packNumber) return err({ kind: "StalePick" });
  const chosen = pack.cards.find((card) => card.slot === input.slot && card.pick === null);
  if (chosen === undefined) return err({ kind: "StalePick" });

  const pickNumber = poolOf(draft, input.seatNumber).length + 1;
  const card: DraftCard = {
    ...chosen,
    pick: { seat: input.seatNumber, pickNumber, auto: input.auto, at: now },
  };
  const cards = pack.cards.map((each) => (each.slot === card.slot ? card : each));
  const direction = DRAFT_STYLES[draft.style].passDirection(draft.round);
  const passed: DraftPack = {
    ...pack,
    cards,
    holderSeat: passTarget(input.seatNumber, direction, draft.seats.length),
    queuePosition: draft.sequence,
  };

  let next: Draft = {
    ...draft,
    sequence: draft.sequence + 1,
    packs: draft.packs.map((each) => (each.packNumber === pack.packNumber ? passed : each)),
    version: draft.version + 1,
  };
  if (roundIsOver(next)) next = endRound(next, now);
  return ok({ draft: refreshDeadlines(next, now), card });
}

/**
 * Rule 9: a seat's deadline starts when a pack reaches the front of its queue, and stays put while
 * that pack is in front. No pack, no timer, or no running draft: no deadline.
 */
export function refreshDeadlines(draft: Draft, now: Date): Draft {
  const timer = draft.timer;
  const seats = draft.seats.map((seat): Seat => {
    const front = currentPack(draft, seat.seatNumber);
    // Bots pick the moment a pack reaches them, so they never wait on a timer.
    if (timer.kind === "off" || front === null || seat.botNumber !== null) {
      return seat.deadline === null && seat.deadlinePack === null
        ? seat
        : { ...seat, deadline: null, deadlinePack: null };
    }
    if (seat.deadlinePack === front.packNumber) return seat;
    return {
      ...seat,
      deadline: new Date(now.getTime() + timer.secondsPerPick * 1000),
      deadlinePack: front.packNumber,
    };
  });
  return { ...draft, seats };
}
