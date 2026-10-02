import type { Actor } from "@/modules/accounts";
import type { SetCode } from "@/modules/catalog";
import type { DeckId, TooManyDecks } from "@/modules/decks";
import { openBooster } from "@/modules/packs";
import { receive, spend, type InsufficientFunds } from "@/modules/wallet";
import { Cents, err, ok, seededRng, type Result } from "@/shared/kernel";
import { chooseAutoPick, isBasicLand, type FactsLookup } from "../domain/auto-pick";
import { dealBasics, takeOutBasics } from "../domain/basics";
import {
  addBot as addBotSeat,
  applyPick,
  checkCanStart,
  checkSeats,
  checkTimer,
  joinDraft as joinTable,
  leaveDraft as leaveTable,
  isBot,
  newDraft,
  removeBot as removeBotSeat,
  seatOf,
  seatsInOrder,
  startDraft as startTable,
  type Draft,
  type DraftId,
  type OpenedPack,
} from "../domain/draft";
import type {
  AlreadyInADraft,
  BoosterNotDraftable,
  BotNotFound,
  BotsForAdminsOnly,
  DraftFull,
  DraftNotFinished,
  DraftNotFound,
  DraftNotOpen,
  DraftNotRunning,
  NotAway,
  NotHost,
  NothingToPick,
  NotSeated,
  PriceUnavailable,
  SeatsInvalid,
  StalePick,
  TimerInvalid,
  TooFewPlayers,
} from "../domain/errors";
import { DRAFT_STYLES } from "../domain/style";
import {
  markPresence as markSeatPresence,
  pickForAway as pickForAwaySeat,
  runBots,
  runTimers as runTableTimers,
  type ChooseCard,
} from "../domain/timers";
import type { DraftsDependencies, DraftsServices } from "./ports";
import { loadFacts, makeDeckFor, settle } from "./settle";

// Draft use cases (design doc 17, section 5). Each runs in one transaction that starts by locking
// the draft, so two picks at the same moment take turns (lock order: draft, wallets, cards, decks).

export type CreateDraftInput = Readonly<{
  setCode: SetCode;
  boosterType: string;
  maxSeats: number;
  /** null turns the pick timer off. */
  secondsPerPick: number | null;
}>;

export type CreateDraftError =
  | BoosterNotDraftable
  | PriceUnavailable
  | SeatsInvalid
  | TimerInvalid
  | AlreadyInADraft
  | InsufficientFunds;
export type JoinDraftError =
  DraftNotFound | DraftNotOpen | DraftFull | AlreadyInADraft | InsufficientFunds;
export type LeaveDraftError = DraftNotFound | NotSeated | DraftNotOpen;
export type StartDraftError =
  DraftNotFound | NotHost | DraftNotOpen | TooFewPlayers | BoosterNotDraftable;
export type PickError = DraftNotFound | NotSeated | DraftNotRunning | StalePick;
export type PickForAwayError = DraftNotFound | NotHost | DraftNotRunning | NotAway | NothingToPick;
export type MakeDraftDeckError = DraftNotFound | NotSeated | DraftNotFinished | TooManyDecks;
export type AddBotError =
  DraftNotFound | BotsForAdminsOnly | NotHost | DraftNotOpen | DraftFull | InsufficientFunds;
export type RemoveBotError = DraftNotFound | NotHost | DraftNotOpen | BotNotFound;

export type PickInput = Readonly<{ draftId: DraftId; packNumber: number; slot: number }>;
export type TimerReport = Readonly<{ drafts: number; autoPicks: number; extensions: number }>;

const choosingWith =
  (facts: FactsLookup): ChooseCard =>
  (pack, pool) =>
    chooseAutoPick(pack, pool, facts);

/** Rule 1: one unfinished draft per player. */
/**
 * Lets every bot with a pack in front of it pick, until none has (rule 16). Bots answer at once,
 * so this runs after anything that can pass a pack to one.
 */
async function letBotsPick(services: DraftsServices, draft: Draft, now: Date): Promise<Draft> {
  if (draft.status !== "drafting" || !draft.seats.some(isBot)) return draft;
  const facts = await loadFacts(services, draft);
  return runBots(draft, now, choosingWith(facts)).draft;
}

async function checkNotInADraft(
  services: DraftsServices,
  actor: Actor,
): Promise<Result<void, AlreadyInADraft>> {
  const active = await services.drafts.activeDraftOf(actor.userId);
  return active === null ? ok() : err({ kind: "AlreadyInADraft", draftId: active });
}

async function chargeFee(
  services: DraftsServices,
  draft: Draft,
  actor: Actor,
  now: Date,
  forWhom = "",
) {
  return spend(services, {
    userId: actor.userId,
    amount: draft.entryFee,
    kind: "draft_entry",
    note: `${await services.draftCatalog.setName(draft.setCode)} draft${forWhom}`,
    ref: `draft:${draft.id}`,
    now,
  });
}

export function makeDrafts(dependencies: DraftsDependencies) {
  const { unitOfWork, clock, seeds } = dependencies;

  /** Runs `work` on a locked draft; a missing draft is `DraftNotFound`. */
  function withDraft<T, E>(
    draftId: DraftId,
    work: (services: DraftsServices, draft: Draft, now: Date) => Promise<Result<T, E>>,
  ): Promise<Result<T, E | DraftNotFound>> {
    return unitOfWork.run<T, E | DraftNotFound>(async (services) => {
      const draft = await services.drafts.lock(draftId);
      if (draft === null) return err({ kind: "DraftNotFound" });
      return work(services, draft, clock.now());
    });
  }

  /** Hosts a new draft: the host takes the first seat and pays the entry fee. */
  async function createDraft(
    actor: Actor,
    input: CreateDraftInput,
  ): Promise<Result<DraftId, CreateDraftError>> {
    const maxSeats = checkSeats(input.maxSeats);
    if (!maxSeats.ok) return maxSeats;
    const timer = checkTimer(input.secondsPerPick);
    if (!timer.ok) return timer;

    return unitOfWork.run<DraftId, CreateDraftError>(async (services) => {
      const free = await checkNotInADraft(services, actor);
      if (!free.ok) return free;
      if ((await services.draftCatalog.draftable(input.setCode, input.boosterType)) === null) {
        return err({ kind: "BoosterNotDraftable" });
      }
      const packPrice = await services.draftCatalog.packPrice(input.setCode, input.boosterType);
      if (packPrice === null) return err({ kind: "PriceUnavailable" });

      const now = clock.now();
      const fresh = newDraft({
        hostId: actor.userId,
        setCode: input.setCode,
        boosterType: input.boosterType,
        maxSeats: maxSeats.value,
        timer: timer.value,
        entryFee: Cents.of(packPrice * DRAFT_STYLES.booster.packsPerPlayer),
        now,
      });
      const draftId = await services.drafts.create(fresh);
      // An error here rolls back the new draft too.
      const paid = await chargeFee(services, { ...fresh, id: draftId }, actor, now);
      if (!paid.ok) return paid;
      return ok(draftId);
    });
  }

  async function joinDraft(actor: Actor, draftId: DraftId): Promise<Result<void, JoinDraftError>> {
    return withDraft<void, JoinDraftError>(draftId, async (services, draft, now) => {
      if (seatOf(draft, actor.userId) !== null) return ok(); // already seated: nothing to do
      const free = await checkNotInADraft(services, actor);
      if (!free.ok) return free;
      const joined = joinTable(draft, actor.userId, now);
      if (!joined.ok) return joined;
      const paid = await chargeFee(services, draft, actor, now);
      if (!paid.ok) return paid;
      await settle(services, draft, joined.value, now);
      return ok();
    });
  }

  /** Leaves a lobby with a refund. The host leaving closes it and refunds everyone (rule 2). */
  async function leaveDraft(
    actor: Actor,
    draftId: DraftId,
  ): Promise<Result<void, LeaveDraftError>> {
    return withDraft<void, LeaveDraftError>(draftId, async (services, draft, now) => {
      const left = leaveTable(draft, actor.userId);
      if (!left.ok) return left;
      for (const refund of left.value.refunds) {
        await receive(services, {
          userId: refund.userId,
          amount: refund.amount,
          kind: "draft_refund",
          note: `${await services.draftCatalog.setName(draft.setCode)} draft`,
          ref: `draft:${draft.id}`,
          now,
        });
      }
      await settle(services, draft, left.value.draft, now);
      return ok();
    });
  }

  /** The host starts the draft: every seat's packs are opened now, with fresh seeds (rule 4). */
  async function startDraft(
    actor: Actor,
    draftId: DraftId,
  ): Promise<Result<void, StartDraftError>> {
    return withDraft<void, StartDraftError>(draftId, async (services, draft, now) => {
      const ready = checkCanStart(draft, actor.userId);
      if (!ready.ok) return ready;
      const opened: OpenedPack[][] = [];
      // One row of packs per seat, in the order seats will sit (startTable renumbers them so).
      for (let seat = 0; seat < seatsInOrder(draft).length; seat += 1) {
        const packs: OpenedPack[] = [];
        for (let round = 1; round <= DRAFT_STYLES[draft.style].packsPerPlayer; round += 1) {
          const seed = seeds.newSeed();
          const pack = await openBooster(services, {
            setCode: draft.setCode,
            boosterType: draft.boosterType,
            seed,
          });
          if (!pack.ok) return err({ kind: "BoosterNotDraftable" });
          packs.push({ seed, cards: pack.value.cards });
        }
        opened.push(packs);
      }
      // Basic lands leave the packs and are dealt to the people at the table (rule 15).
      const facts = await services.draftCatalog.cardFacts(
        opened.flat().flatMap((pack) => pack.cards.map((card) => card.printingId)),
      );
      const { packs, basics } = takeOutBasics(opened, (printingId) => {
        const card = facts.get(printingId);
        return card !== undefined && isBasicLand(card);
      });
      const people = seatsInOrder(draft)
        .filter((seat) => !isBot(seat))
        .map((seat) => seat.userId);
      const dealt = dealBasics(basics, people, seededRng(seeds.newSeed()));
      const started = startTable(draft, packs, now, dealt);
      await settle(services, draft, await letBotsPick(services, started, now), now);
      return ok();
    });
  }

  async function makePick(actor: Actor, input: PickInput): Promise<Result<void, PickError>> {
    return withDraft<void, PickError>(input.draftId, async (services, draft, now) => {
      const seat = seatOf(draft, actor.userId);
      if (seat === null) return err({ kind: "NotSeated" });
      const picked = applyPick(
        draft,
        {
          seatNumber: seat.seatNumber,
          packNumber: input.packNumber,
          slot: input.slot,
          auto: false,
        },
        now,
      );
      if (!picked.ok) return picked;
      // Picking also shows the player is here.
      const here = markSeatPresence(picked.value.draft, actor.userId, true, now);
      await settle(services, draft, await letBotsPick(services, here, now), now);
      return ok();
    });
  }

  /** The host picks for a player who has gone (the timer does this by itself when it's on). */
  async function pickForAway(
    actor: Actor,
    input: { draftId: DraftId; seatNumber: number },
  ): Promise<Result<void, PickForAwayError>> {
    return withDraft<void, PickForAwayError>(input.draftId, async (services, draft, now) => {
      if (draft.hostId !== actor.userId) return err({ kind: "NotHost" });
      const facts = await loadFacts(services, draft);
      const picked = pickForAwaySeat(draft, input.seatNumber, now, choosingWith(facts));
      if (!picked.ok) return picked;
      await settle(services, draft, await letBotsPick(services, picked.value.draft, now), now);
      return ok();
    });
  }

  /**
   * Records that a seat's browser is here or has gone (section 7). Does nothing for someone who
   * isn't seated, so any signed-in player can watch a lobby.
   */
  async function markPresence(actor: Actor, draftId: DraftId, here: boolean): Promise<void> {
    await withDraft<void, never>(draftId, async (services, draft, now) => {
      const after = markSeatPresence(draft, actor.userId, here, now);
      // The same object back means "not seated here": nothing to save.
      if (after !== draft) await settle(services, draft, after, now);
      return ok();
    });
  }

  /**
   * The worker's job (rule 10): every draft with a deadline that has passed gets its grace or its
   * auto-picks, each draft in its own transaction.
   */
  async function runTimers(): Promise<TimerReport> {
    const due = await unitOfWork.run<DraftId[], never>(async (services) =>
      ok(await services.drafts.withDeadlineBefore(clock.now())),
    );
    let autoPicks = 0;
    let extensions = 0;
    for (const draftId of due.ok ? due.value : []) {
      await withDraft<void, never>(draftId, async (services, draft, now) => {
        const facts = await loadFacts(services, draft);
        const outcome = runTableTimers(draft, now, choosingWith(facts));
        autoPicks += outcome.autoPicks.length;
        extensions += outcome.extensions;
        await settle(services, draft, await letBotsPick(services, outcome.draft, now), now);
        return ok();
      });
    }
    return { drafts: due.ok ? due.value.length : 0, autoPicks, extensions };
  }

  /**
   * An admin hosting a lobby adds a bot, paying its entry fee; its picks will go to them
   * (rule 16). A testing tool: it lets one person try a whole draft.
   */
  async function addBot(actor: Actor, draftId: DraftId): Promise<Result<void, AddBotError>> {
    return withDraft<void, AddBotError>(draftId, async (services, draft, now) => {
      const added = addBotSeat(draft, actor, now);
      if (!added.ok) return added;
      const bot = added.value.seats[added.value.seats.length - 1];
      const paid = await chargeFee(services, draft, actor, now, ` (Bot ${bot.botNumber})`);
      if (!paid.ok) return paid;
      await settle(services, draft, added.value, now);
      return ok();
    });
  }

  /** The host takes a bot out of the lobby, with its fee refunded. */
  async function removeBot(
    actor: Actor,
    input: { draftId: DraftId; botNumber: number },
  ): Promise<Result<void, RemoveBotError>> {
    return withDraft<void, RemoveBotError>(input.draftId, async (services, draft, now) => {
      const removed = removeBotSeat(draft, actor.userId, input.botNumber);
      if (!removed.ok) return removed;
      await receive(services, {
        userId: removed.value.refund.userId,
        amount: removed.value.refund.amount,
        kind: "draft_refund",
        note: `${await services.draftCatalog.setName(draft.setCode)} draft (Bot ${input.botNumber})`,
        ref: `draft:${draft.id}`,
        now,
      });
      await settle(services, draft, removed.value.draft, now);
      return ok();
    });
  }

  /** Makes the draft deck again, for a player who had no room, or deleted it. */
  async function makeDraftDeck(
    actor: Actor,
    draftId: DraftId,
  ): Promise<Result<DeckId, MakeDraftDeckError>> {
    return withDraft<DeckId, MakeDraftDeckError>(draftId, async (services, draft, now) => {
      const seat = seatOf(draft, actor.userId);
      if (seat === null) return err({ kind: "NotSeated" });
      if (draft.status !== "finished") return err({ kind: "DraftNotFinished" });
      return makeDeckFor(services, draft, seat, await loadFacts(services, draft), now);
    });
  }

  return {
    createDraft,
    joinDraft,
    leaveDraft,
    startDraft,
    makePick,
    pickForAway,
    markPresence,
    runTimers,
    makeDraftDeck,
    addBot,
    removeBot,
  };
}

export type Drafts = ReturnType<typeof makeDrafts>;
