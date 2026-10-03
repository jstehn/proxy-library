import type { UserId } from "@/shared/kernel";
import { err, ok, type Result } from "@/shared/kernel";
import { dealWaitsFor, passOnDeal } from "./deals";
import {
  cardAt,
  currentPack,
  poolOf,
  seatAt,
  seatOf,
  withSeat,
  type Draft,
  type DraftCard,
  type DraftPack,
  type Seat,
} from "./draft";
import type { DraftNotRunning, NotAway, NothingToPick } from "./errors";
import {
  chooseColor,
  decideOnCard,
  draftStep,
  faceUpWith,
  owedColor,
  randomColor,
  type StepContext,
} from "./steps";
import { pickScore, topColors, factsOf } from "./auto-pick";

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

const isDue = (at: Date | null, now: Date) => at !== null && at.getTime() <= now.getTime();

function overdueSeat(draft: Draft, now: Date): Seat | null {
  if (draft.status !== "drafting") return null;
  const overdue = draft.seats
    .filter((seat) => isDue(seat.deadline, now) || isDue(seat.promptDeadline, now))
    .sort(
      (a, b) =>
        Math.min(a.deadline?.getTime() ?? Infinity, a.promptDeadline?.getTime() ?? Infinity) -
        Math.min(b.deadline?.getTime() ?? Infinity, b.promptDeadline?.getTime() ?? Infinity),
    );
  return overdue[0] ?? null;
}

function smartColor(
  draft: Draft,
  seatNumber: number,
  note: Extract<import("./abilities").Note, { kind: "colors" }>,
  ctx: StepContext,
): import("@/modules/catalog").Color {
  const pool = poolOf(draft, seatNumber).map((c) => factsOf(ctx.cards, c.printingId));
  const top = topColors(pool);
  const openTop = top.filter((c) => !note.colors.includes(c));
  if (openTop.length > 0) return openTop[0];
  return randomColor(note, ctx.rng);
}

function smartDeal(
  draft: Draft,
  seatNumber: number,
  ctx: StepContext,
): { draft: Draft; card: null } | null {
  const deal = draft.deals?.current;
  if (draft.status !== "dealing" || deal == null) return null;

  // Simplified: just pass. Deals for bots would require evaluating offers which is complex here.
  // For now, bots don't participate heavily in deals, per design.
  const dealt = passOnDeal(draft, seatNumber, ctx);
  return dealt !== null ? { draft: dealt, card: null } : null;
}

/**
 * Does the one thing a seat is holding the table up with, the way a bot would: chooses an owed
 * color, makes no choices about a card drawn at random, answers a deal step with "no", or
 * drafts the card `choose` picks (at random under a face-up Archdemon), using no optional
 * ability. Returns the drafted card, if a card was drafted; null when there's nothing to do.
 */
export function actFor(
  draft: Draft,
  seatNumber: number,
  ctx: StepContext,
  choose: ChooseCard,
): { draft: Draft; card: DraftCard | null } | null {
  const owed = owedColor(draft, seatNumber);
  if (owed !== null) {
    const chosen = chooseColor(
      draft,
      seatNumber,
      smartColor(draft, seatNumber, owed.note, ctx),
      ctx,
    );
    return chosen.ok ? { draft: chosen.value, card: null } : null;
  }
  if (seatAt(draft, seatNumber).abilities.awaitingChoices !== null) {
    const decided = decideOnCard(draft, seatNumber, {}, ctx);
    return decided.ok ? { draft: decided.value, card: null } : null;
  }
  const dealt = smartDeal(draft, seatNumber, ctx);
  if (dealt !== null) return dealt;

  const pack = currentPack(draft, seatNumber);
  if (draft.status !== "drafting" || pack === null) return null;
  const atRandom = faceUpWith(draft, seatNumber, "random", ctx).length > 0;
  const slot = atRandom ? "random" : choose(pack, poolOf(draft, seatNumber));
  // A Spire Phantasm drafted this way guesses another card left in the pack.
  const poolFacts = poolOf(draft, seatNumber).map((c) => factsOf(ctx.cards, c.printingId));
  let other = pack.cards.find((card) => card.pick === null && card.slot !== slot);
  if (!atRandom) {
    const others = pack.cards.filter((c) => c.pick === null && c.slot !== slot);
    if (others.length > 0) {
      other = others.reduce((best, c) =>
        pickScore(factsOf(ctx.cards, c.printingId), poolFacts) >
        pickScore(factsOf(ctx.cards, best.printingId), poolFacts)
          ? c
          : best,
      );
    }
  }
  const guess = other === undefined ? undefined : ctx.cards(other.printingId)?.name;

  let wholePack = false;
  const agents = faceUpWith(draft, seatNumber, "wholePack", ctx);
  if (agents.length > 0 && !atRandom) {
    const goodCards = pack.cards.filter(
      (c) => c.pick === null && pickScore(factsOf(ctx.cards, c.printingId), poolFacts) >= 1.5,
    );
    if (goodCards.length >= 3) wholePack = true;
  }

  let librarians = 0;
  const libs = faceUpWith(draft, seatNumber, "extraCard", ctx).filter((c) => {
    const pId = cardAt(draft, c)?.printingId;
    return pId ? ctx.cards(pId)?.name === "Cogwork Librarian" : false;
  });
  if (libs.length > 0 && !wholePack && !atRandom) {
    const goodCards = pack.cards.filter(
      (c) => c.pick === null && pickScore(factsOf(ctx.cards, c.printingId), poolFacts) >= 2.0,
    );
    if (goodCards.length >= 2) librarians = 1;
  }

  const stepped = draftStep(
    draft,
    {
      seatNumber,
      packNumber: pack.packNumber,
      slot,
      auto: true,
      choices: {
        guess,
        wholePack: wholePack ? true : undefined,
        librarians: librarians > 0 ? librarians : undefined,
      },
    },
    ctx,
  );
  if (!stepped.ok)
    throw new Error(`auto-pick for seat ${seatNumber} failed: ${stepped.error.kind}`);
  return { draft: stepped.value.draft, card: cardAt(stepped.value.draft, stepped.value.card) };
}

/**
 * Deals with every seat whose deadline has passed (rule 10): an away seat with grace left gets
 * more time; anyone else has the server act for them (actFor). A deal step past its deadline is
 * answered "no" for whoever it waits for. One seat at a time, earliest deadline first, because
 * each action can change who is waiting.
 */
export function runTimers(draft: Draft, ctx: StepContext, choose: ChooseCard): TimerOutcome {
  const now = ctx.now;
  let current = draft;
  const autoPicks: Array<{ seatNumber: number; card: DraftCard }> = [];
  let extensions = 0;
  const cardCount = draft.packs.reduce((total, pack) => total + pack.cards.length, 0);
  for (let guard = 0; guard <= (cardCount + draft.seats.length) * 4; guard += 1) {
    const deal = current.deals?.current;
    if (current.status === "dealing" && deal != null && isDue(deal.deadline, now)) {
      const waiting = dealWaitsFor(current)[0];
      const passed = waiting === undefined ? null : passOnDeal(current, waiting, ctx);
      if (passed === null) break;
      current = passed;
      continue;
    }
    const seat = overdueSeat(current, now);
    if (seat === null) break;

    const grace = graceLeft(seat);
    if (isAway(seat, now) && grace > 0) {
      // From now, not from the old deadline: if the worker was stopped for a while, the old
      // deadline plus the grace could already be in the past.
      const until = new Date(now.getTime() + grace * 1000);
      const extended: Seat = {
        ...seat,
        deadline: isDue(seat.deadline, now) ? until : seat.deadline,
        promptDeadline: isDue(seat.promptDeadline, now) ? until : seat.promptDeadline,
        graceUsedSeconds: seat.graceUsedSeconds + grace,
      };
      current = { ...withSeat(current, extended), version: current.version + 1 };
      extensions += 1;
      continue;
    }

    const acted = actFor(current, seat.seatNumber, ctx, choose);
    if (acted === null) {
      // Nothing to do after all: clear the stale deadlines so this seat isn't picked again.
      current = withSeat(current, { ...seat, deadline: null, promptDeadline: null });
      continue;
    }
    current = acted.draft;
    if (acted.card !== null) autoPicks.push({ seatNumber: seat.seatNumber, card: acted.card });
  }
  return { draft: current, autoPicks, extensions };
}

/**
 * The host does it for a player who has gone (useful with the timer off): their pick, their owed
 * color, or their deal step.
 */
export function pickForAway(
  draft: Draft,
  seatNumber: number,
  ctx: StepContext,
  choose: ChooseCard,
): Result<{ draft: Draft; card: DraftCard | null }, DraftNotRunning | NotAway | NothingToPick> {
  if (draft.status !== "drafting" && draft.status !== "dealing")
    return err({ kind: "DraftNotRunning" });
  const seat = draft.seats.find((each) => each.seatNumber === seatNumber);
  if (seat === undefined || !isAway(seat, ctx.now)) return err({ kind: "NotAway" });
  const acted = actFor(draft, seatNumber, ctx, choose);
  return acted === null ? err({ kind: "NothingToPick" }) : ok(acted);
}

/**
 * Bots act the moment they can (design doc 17, rule 16): they pick, choose colors, and say no to
 * deals, again and again, until no bot has anything to do. Run after anything that can reach a
 * bot: a passed pack, a color owed, a deal step.
 */
export function runBots(
  draft: Draft,
  ctx: StepContext,
  choose: ChooseCard,
): Readonly<{ draft: Draft; picks: number }> {
  let current = draft;
  let picks = 0;
  const cardCount = draft.packs.reduce((total, pack) => total + pack.cards.length, 0);
  for (let guard = 0; guard <= (cardCount + draft.seats.length) * 4; guard += 1) {
    let acted: ReturnType<typeof actFor> = null;
    for (const bot of current.seats.filter((seat) => seat.botNumber !== null)) {
      acted = actFor(current, bot.seatNumber, ctx, choose);
      if (acted !== null) break;
    }
    if (acted === null) break;
    current = acted.draft;
    if (acted.card !== null) picks += 1;
  }
  return { draft: current, picks };
}
