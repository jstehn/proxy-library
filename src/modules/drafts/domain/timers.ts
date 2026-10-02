import type { UserId } from "@/shared/kernel";
import { err, ok, type Result } from "@/shared/kernel";
import {
  applyPick,
  currentPack,
  seatOf,
  type Draft,
  type DraftCard,
  type DraftPack,
  type Seat,
} from "./draft";
import type { DraftNotRunning, NotAway, NothingToPick } from "./errors";

// Presence, grace and timeouts (design doc 17, rules 9 and 10).

/** A seat whose browser hasn't been in touch for this long is away. */
export const AWAY_AFTER_SECONDS = 40;
/** Extra time an away seat gets each time its deadline passes… */
export const GRACE_SECONDS = 120;
/** …up to this much in one draft. */
export const GRACE_BUDGET_SECONDS = 300;

export function isAway(seat: Pick<Seat, "lastSeenAt" | "botNumber">, now: Date): boolean {
  if (seat.botNumber !== null) return false; // a bot is always at the table
  if (seat.lastSeenAt === null) return true;
  return now.getTime() - seat.lastSeenAt.getTime() > AWAY_AFTER_SECONDS * 1000;
}

/**
 * Records that a seat's browser is here (`here: true`, on connect and every heartbeat) or has gone.
 * The version only goes up when the seat's away/here state changes, so heartbeats stay quiet.
 * Players who aren't seated, and finished drafts, are left alone.
 */
export function markPresence(draft: Draft, userId: UserId, here: boolean, now: Date): Draft {
  const seat = seatOf(draft, userId);
  if (seat === null || (draft.status !== "lobby" && draft.status !== "drafting")) return draft;
  const wasAway = isAway(seat, now);
  const updated: Seat = { ...seat, lastSeenAt: here ? now : null };
  const changed = wasAway !== isAway(updated, now);
  return {
    ...draft,
    seats: draft.seats.map((each) => (each.seatNumber === updated.seatNumber ? updated : each)),
    version: changed ? draft.version + 1 : draft.version,
  };
}

/** Chooses the slot to auto-pick from a pack, knowing the seat's pool so far. */
export type ChooseCard = (pack: DraftPack, pool: readonly DraftCard[]) => number;

export type TimerOutcome = Readonly<{
  draft: Draft;
  autoPicks: ReadonlyArray<{ seatNumber: number; card: DraftCard }>;
  extensions: number;
}>;

/** How much grace an away seat still has, capped at one extension. */
function graceLeft(seat: Seat): number {
  return Math.min(GRACE_SECONDS, GRACE_BUDGET_SECONDS - seat.graceUsedSeconds);
}

function overdueSeat(draft: Draft, now: Date): Seat | null {
  if (draft.status !== "drafting") return null;
  const overdue = draft.seats
    .filter((seat) => seat.deadline !== null && seat.deadline.getTime() <= now.getTime())
    .sort((a, b) => (a.deadline?.getTime() ?? 0) - (b.deadline?.getTime() ?? 0));
  return overdue[0] ?? null;
}

/**
 * Deals with every seat whose deadline has passed (rule 10): an away seat with grace left gets
 * more time; anyone else gets the card `choose` picks. Seats are handled one at a time, earliest
 * deadline first, because each pick passes a pack and can change who is waiting.
 */
export function runTimers(draft: Draft, now: Date, choose: ChooseCard): TimerOutcome {
  let current = draft;
  const autoPicks: Array<{ seatNumber: number; card: DraftCard }> = [];
  let extensions = 0;
  // Every pass picks a card or uses up grace, so this ends; the cap only guards against a bug.
  const cardCount = draft.packs.reduce((total, pack) => total + pack.cards.length, 0);
  for (let guard = 0; guard <= cardCount + draft.seats.length * 3; guard += 1) {
    const seat = overdueSeat(current, now);
    if (seat === null) break;

    const grace = graceLeft(seat);
    if (isAway(seat, now) && grace > 0) {
      // From now, not from the old deadline: if the worker was stopped for a while, the old
      // deadline plus the grace could already be in the past.
      const extended: Seat = {
        ...seat,
        deadline: new Date(now.getTime() + grace * 1000),
        graceUsedSeconds: seat.graceUsedSeconds + grace,
      };
      current = {
        ...current,
        seats: current.seats.map((each) => (each.seatNumber === seat.seatNumber ? extended : each)),
        version: current.version + 1,
      };
      extensions += 1;
      continue;
    }

    const picked = autoPick(current, seat.seatNumber, now, choose);
    if (!picked.ok) throw new Error(`seat ${seat.seatNumber} is overdue with nothing to pick`);
    current = picked.value.draft;
    autoPicks.push({ seatNumber: seat.seatNumber, card: picked.value.card });
  }
  return { draft: current, autoPicks, extensions };
}

/** Picks for a seat with `choose`: used by the timer and by the host's "pick for them". */
export function autoPick(
  draft: Draft,
  seatNumber: number,
  now: Date,
  choose: ChooseCard,
): Result<{ draft: Draft; card: DraftCard }, DraftNotRunning | NothingToPick> {
  if (draft.status !== "drafting") return err({ kind: "DraftNotRunning" });
  const pack = currentPack(draft, seatNumber);
  if (pack === null) return err({ kind: "NothingToPick" });
  const pool = draft.packs.flatMap((each) => each.cards).filter((c) => c.pick?.seat === seatNumber);
  const slot = choose(pack, pool);
  const picked = applyPick(
    draft,
    { seatNumber, packNumber: pack.packNumber, slot, auto: true },
    now,
  );
  if (!picked.ok) throw new Error(`auto-pick chose slot ${slot}, which isn't in the pack`);
  return ok(picked.value);
}

/** The host picks for a player who has gone (useful with the timer off). */
export function pickForAway(
  draft: Draft,
  seatNumber: number,
  now: Date,
  choose: ChooseCard,
): Result<{ draft: Draft; card: DraftCard }, DraftNotRunning | NotAway | NothingToPick> {
  const seat = draft.seats.find((each) => each.seatNumber === seatNumber);
  if (seat === undefined || !isAway(seat, now)) return err({ kind: "NotAway" });
  return autoPick(draft, seatNumber, now, choose);
}

/**
 * Every bot with a pack in front of it picks, again and again, until no bot has anything to pick
 * (rule 16). Run after anything that can pass a pack: a bot passes to a bot, which picks at once.
 */
export function runBots(
  draft: Draft,
  now: Date,
  choose: ChooseCard,
): Readonly<{ draft: Draft; picks: number }> {
  let current = draft;
  let picks = 0;
  const cardCount = draft.packs.reduce((total, pack) => total + pack.cards.length, 0);
  for (let guard = 0; guard <= cardCount; guard += 1) {
    const bot = current.seats.find(
      (seat) => seat.botNumber !== null && currentPack(current, seat.seatNumber) !== null,
    );
    if (bot === undefined) break;
    const picked = autoPick(current, bot.seatNumber, now, choose);
    if (!picked.ok) break;
    current = picked.value.draft;
    picks += 1;
  }
  return { draft: current, picks };
}
