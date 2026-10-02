import type { Actor } from "@/modules/accounts";
import { SetCode, type Color } from "@/modules/catalog";
import type { DeckId, TooManyDecks } from "@/modules/decks";
import { ItemId, openPackForDraft } from "@/modules/inventory";
import { openBooster } from "@/modules/packs";
import { receive, spend, type InsufficientFunds } from "@/modules/wallet";
import { Cents, err, ok, seededRng, type Result } from "@/shared/kernel";
import { peekAtPack, watchPlayer } from "../domain/actions";
import { abilityOf, type CardRef } from "../domain/abilities";
import { chooseAutoPick, isBasicLand, type FactsLookup } from "../domain/auto-pick";
import { dealBasics, takeOutBasics } from "../domain/basics";
import { acceptDeal, endDeals as endDealsNow, offerForDeal, revealForDeal } from "../domain/deals";
import {
  addBot as addBotSeat,
  cardAt,
  checkCanStart,
  checkSeats,
  checkTimer,
  isBot,
  joinDraft as joinTable,
  leaveDraft as leaveTable,
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
  AbilityUnavailable,
  AlreadyInADraft,
  BoosterNotDraftable,
  BotNotFound,
  BotsForAdminsOnly,
  CardNoLongerOwned,
  DraftFull,
  DraftNotFinished,
  DraftNotFound,
  DraftNotOpen,
  DraftNotRunning,
  LorePackUnavailable,
  NotAway,
  NotHost,
  NothingToAnswer,
  NothingToPick,
  NotSeated,
  PriceUnavailable,
  SeatsInvalid,
  TimerInvalid,
  TooFewPlayers,
} from "../domain/errors";
import {
  chooseColor as chooseTableColor,
  decideOnCard,
  draftStep,
  type AddedPack,
  type StepChoices,
  type StepContext,
  type StepError,
} from "../domain/steps";
import { DRAFT_STYLES } from "../domain/style";
import {
  markPresence as markSeatPresence,
  pickForAway as pickForAwaySeat,
  runBots,
  runTimers as runTableTimers,
  type ChooseCard,
} from "../domain/timers";
import { visibleTo, type DraftSeen } from "../domain/visibility";
import type { DraftsDependencies, DraftsServices } from "./ports";
import { loadFacts, makeDeckFor, settle } from "./settle";

// Draft use cases (design docs 17 and 18). Each runs in one transaction that starts by locking
// the draft, so two actions at the same moment take turns (lock order: draft, wallets, cards,
// decks). Every change goes through the pure domain, then bots act, then `settle` saves it.

export type CreateDraftInput = Readonly<{
  setCode: SetCode;
  boosterType: string;
  maxSeats: number;
  /** null turns the pick timer off. */
  secondsPerPick: number | null;
}>;

/** Where a Lore Seeker's added pack comes from (design doc 18, decision 2). */
export type LorePackSource =
  | Readonly<{ source: "inventory"; itemId: number }>
  | Readonly<{ source: "buy"; setCode: string; boosterType: string }>;

/** The choices about the card being drafted, as a player sends them. */
export type PickChoices = Omit<StepChoices, "addPack"> & Readonly<{ addPack?: LorePackSource }>;

export type PickInput = Readonly<{
  draftId: DraftId;
  packNumber: number;
  /** A slot, or "random" while an Archdemon of Paliano is face up. */
  slot: number | "random";
  choices?: PickChoices;
}>;

export type DealAnswer =
  | Readonly<{ draftId: DraftId; step: "reveal"; card: CardRef | null }>
  | Readonly<{ draftId: DraftId; step: "offer"; card: CardRef | null }>
  | Readonly<{ draftId: DraftId; step: "accept"; offerSeat: number | null }>;

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
export type PickError =
  | DraftNotFound
  | NotSeated
  | StepError
  | LorePackUnavailable
  | InsufficientFunds
  | CardNoLongerOwned;
export type AnswerError =
  | DraftNotFound
  | NotSeated
  | DraftNotRunning
  | AbilityUnavailable
  | NothingToAnswer
  | LorePackUnavailable
  | InsufficientFunds
  | CardNoLongerOwned;
export type PickForAwayError =
  DraftNotFound | NotHost | DraftNotRunning | NotAway | NothingToPick | CardNoLongerOwned;
export type EndDealsError = DraftNotFound | NotHost | DraftNotRunning | CardNoLongerOwned;
export type MakeDraftDeckError = DraftNotFound | NotSeated | DraftNotFinished | TooManyDecks;
export type AddBotError =
  DraftNotFound | BotsForAdminsOnly | NotHost | DraftNotOpen | DraftFull | InsufficientFunds;
export type RemoveBotError = DraftNotFound | NotHost | DraftNotOpen | BotNotFound;

export type TimerReport = Readonly<{ drafts: number; autoPicks: number; extensions: number }>;

const choosingWith =
  (facts: FactsLookup): ChooseCard =>
  (pack, pool) =>
    chooseAutoPick(pack, pool, facts);

/** Rule 1: one unfinished draft per player. */
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

  /** What the engine needs for this draft now: card facts, the time, a fresh seed. */
  async function contextFor(
    services: DraftsServices,
    draft: Draft,
    now: Date,
  ): Promise<StepContext> {
    return { now, cards: await loadFacts(services, draft), rng: seededRng(seeds.newSeed()) };
  }

  /** Bots act on anything that has reached them (rule 16), with facts for any new cards. */
  async function letBotsAct(services: DraftsServices, draft: Draft, now: Date): Promise<Draft> {
    const running = draft.status === "drafting" || draft.status === "dealing";
    if (!draft.seats.some(isBot) || !running) return draft;
    const ctx = await contextFor(services, draft, now);
    return runBots(draft, ctx, choosingWith(ctx.cards)).draft;
  }

  /** Bots act, then the change is saved with everything that goes with it. */
  async function save(
    services: DraftsServices,
    before: Draft,
    after: Draft,
    now: Date,
  ): Promise<Result<void, CardNoLongerOwned>> {
    return settle(services, before, await letBotsAct(services, after, now), now);
  }

  /**
   * Opens a Lore Seeker's added pack: one of the player's unopened packs, or one bought at the
   * store's price. Its basic lands are dealt out like the others (design doc 17, rule 15).
   */
  async function openLorePack(
    services: DraftsServices,
    actor: Actor,
    draft: Draft,
    request: LorePackSource,
    ctx: StepContext,
  ): Promise<Result<AddedPack, LorePackUnavailable | InsufficientFunds>> {
    const seed = seeds.newSeed();
    const unavailable = (reason: string) =>
      err<LorePackUnavailable>({ kind: "LorePackUnavailable", reason });
    let opened: OpenedPack;
    if (request.source === "inventory") {
      const pack = await openPackForDraft(services, {
        ownerId: actor.userId,
        itemId: ItemId.of(request.itemId),
        seed,
        now: ctx.now,
      });
      if (!pack.ok) return unavailable("that isn't an unopened booster pack of yours");
      opened = { seed, cards: pack.value.cards };
    } else {
      const setCode = SetCode.of(request.setCode);
      const price = await services.draftCatalog.packPrice(setCode, request.boosterType);
      if (price === null) return unavailable("the store has no price for that pack");
      const pack = await openBooster(services, {
        setCode,
        boosterType: request.boosterType,
        seed,
      });
      if (!pack.ok) return unavailable("that booster can't be opened");
      const paid = await spend(services, {
        userId: actor.userId,
        amount: price,
        kind: "draft_entry",
        note: `Lore Seeker pack: ${await services.draftCatalog.setName(setCode)}`,
        ref: `draft:${draft.id}`,
        now: ctx.now,
      });
      if (!paid.ok) return paid;
      opened = { seed, cards: pack.value.cards };
    }
    const facts = await services.draftCatalog.cardFacts(
      opened.cards.map((card) => card.printingId),
    );
    const { packs, basics } = takeOutBasics([[opened]], (printingId) => {
      const card = facts.get(printingId);
      return card !== undefined && isBasicLand(card);
    });
    const people = seatsInOrder(draft)
      .filter((seat) => !isBot(seat))
      .map((seat) => seat.userId);
    return ok({ pack: packs[0][0], basics: dealBasics(basics, people, ctx.rng) });
  }

  /** The player's choices, with a Lore Seeker's pack opened if they asked for one. */
  async function resolveChoices(
    services: DraftsServices,
    actor: Actor,
    draft: Draft,
    drafting: CardRef | null,
    choices: PickChoices | undefined,
    ctx: StepContext,
  ): Promise<Result<StepChoices, LorePackUnavailable | InsufficientFunds>> {
    const { addPack, ...rest } = choices ?? {};
    if (addPack === undefined || drafting === null) return ok(rest);
    const card = cardAt(draft, drafting);
    // Only a Lore Seeker adds a pack: anything else ignores the request (and nothing is spent).
    if (card === null || abilityOf(ctx.cards(card.printingId)?.name)?.ability.kind !== "addPack") {
      return ok(rest);
    }
    const opened = await openLorePack(services, actor, draft, addPack, ctx);
    return opened.ok ? ok({ ...rest, addPack: opened.value }) : opened;
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
      // Nobody has drafted yet, so no card can be "no longer owned".
      await save(services, draft, startTable(draft, packs, now, dealt), now);
      return ok();
    });
  }

  /** Drafts one card: one step of a turn with a pack (design doc 18, section 7). */
  async function makePick(actor: Actor, input: PickInput): Promise<Result<void, PickError>> {
    return withDraft<void, PickError>(input.draftId, async (services, draft, now) => {
      const seat = seatOf(draft, actor.userId);
      if (seat === null) return err({ kind: "NotSeated" });
      const ctx = await contextFor(services, draft, now);
      const drafting =
        input.slot === "random" ? null : { packNumber: input.packNumber, slot: input.slot };
      const choices = await resolveChoices(services, actor, draft, drafting, input.choices, ctx);
      if (!choices.ok) return choices;
      const stepped = draftStep(
        draft,
        {
          seatNumber: seat.seatNumber,
          packNumber: input.packNumber,
          slot: input.slot,
          auto: false,
          choices: choices.value,
        },
        ctx,
      );
      if (!stepped.ok) return stepped;
      // Drafting also shows the player is here.
      const here = markSeatPresence(stepped.value.draft, actor.userId, true, now);
      return save(services, draft, here, now);
    });
  }

  /** The choices about a card drawn at random (Archdemon of Paliano), once it's been seen. */
  async function decideCard(
    actor: Actor,
    input: { draftId: DraftId; choices: PickChoices },
  ): Promise<Result<void, AnswerError>> {
    return withDraft<void, AnswerError>(input.draftId, async (services, draft, now) => {
      const seat = seatOf(draft, actor.userId);
      if (seat === null) return err({ kind: "NotSeated" });
      const ctx = await contextFor(services, draft, now);
      const choices = await resolveChoices(
        services,
        actor,
        draft,
        seat.abilities.awaitingChoices,
        input.choices,
        ctx,
      );
      if (!choices.ok) return choices;
      const decided = decideOnCard(draft, seat.seatNumber, choices.value, ctx);
      if (!decided.ok) return decided;
      return save(services, draft, decided.value, now);
    });
  }

  /** A color the player owes (Paliano, the High City; Regicide). */
  async function chooseColor(
    actor: Actor,
    input: { draftId: DraftId; color: Color },
  ): Promise<Result<void, AnswerError>> {
    return withDraft<void, AnswerError>(input.draftId, async (services, draft, now) => {
      const seat = seatOf(draft, actor.userId);
      if (seat === null) return err({ kind: "NotSeated" });
      const ctx = await contextFor(services, draft, now);
      const chosen = chooseTableColor(draft, seat.seatNumber, input.color, ctx);
      if (!chosen.ok) return chosen;
      return save(services, draft, chosen.value, now);
    });
  }

  /** Whispergear Sneak: look at a pack. */
  async function peekWithSneak(
    actor: Actor,
    input: { draftId: DraftId; card: CardRef; packNumber: number },
  ): Promise<Result<void, AnswerError>> {
    return withDraft<void, AnswerError>(input.draftId, async (services, draft, now) => {
      const seat = seatOf(draft, actor.userId);
      if (seat === null) return err({ kind: "NotSeated" });
      const ctx = await contextFor(services, draft, now);
      const peeked = peekAtPack(draft, seat.seatNumber, input.card, input.packNumber, ctx);
      if (!peeked.ok) return peeked;
      return save(services, draft, peeked.value, now);
    });
  }

  /** Illusionary Informant: see the next card another player drafts. */
  async function watchWithInformant(
    actor: Actor,
    input: { draftId: DraftId; card: CardRef; targetSeat: number },
  ): Promise<Result<void, AnswerError>> {
    return withDraft<void, AnswerError>(input.draftId, async (services, draft, now) => {
      const seat = seatOf(draft, actor.userId);
      if (seat === null) return err({ kind: "NotSeated" });
      const ctx = await contextFor(services, draft, now);
      const watching = watchPlayer(draft, seat.seatNumber, input.card, input.targetSeat, ctx);
      if (!watching.ok) return watching;
      return save(services, draft, watching.value, now);
    });
  }

  /**
   * One Deal Broker step (design doc 18): the broker reveals a card or makes no deal, the others
   * offer a card or nothing, the broker accepts one offer or none.
   */
  async function answerDeal(actor: Actor, input: DealAnswer): Promise<Result<void, AnswerError>> {
    return withDraft<void, AnswerError>(input.draftId, async (services, draft, now) => {
      const seat = seatOf(draft, actor.userId);
      if (seat === null) return err({ kind: "NotSeated" });
      const ctx = await contextFor(services, draft, now);
      const answered =
        input.step === "reveal"
          ? revealForDeal(draft, seat.seatNumber, input.card, ctx)
          : input.step === "offer"
            ? offerForDeal(draft, seat.seatNumber, input.card, ctx)
            : acceptDeal(draft, seat.seatNumber, input.offerSeat, ctx);
      if (!answered.ok) return answered;
      return save(services, draft, answered.value, now);
    });
  }

  /** The host ends the deals: pools are final as they are (timer off, someone has gone). */
  async function endDeals(actor: Actor, draftId: DraftId): Promise<Result<void, EndDealsError>> {
    return withDraft<void, EndDealsError>(draftId, async (services, draft, now) => {
      if (draft.hostId !== actor.userId) return err({ kind: "NotHost" });
      if (draft.status !== "dealing") return err({ kind: "DraftNotRunning" });
      const ended = endDealsNow(draft, await contextFor(services, draft, now));
      return settle(services, draft, ended, now);
    });
  }

  /** The host does what a player who has gone would do: a pick, an owed color, a deal step. */
  async function pickForAway(
    actor: Actor,
    input: { draftId: DraftId; seatNumber: number },
  ): Promise<Result<void, PickForAwayError>> {
    return withDraft<void, PickForAwayError>(input.draftId, async (services, draft, now) => {
      if (draft.hostId !== actor.userId) return err({ kind: "NotHost" });
      const ctx = await contextFor(services, draft, now);
      const acted = pickForAwaySeat(draft, input.seatNumber, ctx, choosingWith(ctx.cards));
      if (!acted.ok) return acted;
      return save(services, draft, acted.value.draft, now);
    });
  }

  /**
   * Records that a seat's browser is here or has gone (section 7). Does nothing for someone who
   * isn't seated, so any signed-in player can watch a lobby.
   */
  async function markPresence(actor: Actor, draftId: DraftId, here: boolean): Promise<void> {
    await withDraft<void, CardNoLongerOwned>(draftId, async (services, draft, now) => {
      const after = markSeatPresence(draft, actor.userId, here, now);
      // The same object back means "not seated here": nothing to save.
      if (after === draft) return ok();
      return settle(services, draft, after, now);
    });
  }

  /**
   * The worker's job (rule 10): every draft with a deadline that has passed gets its grace or its
   * automatic action, each draft in its own transaction.
   */
  async function runTimers(): Promise<TimerReport> {
    const due = await unitOfWork.run<DraftId[], never>(async (services) =>
      ok(await services.drafts.withDeadlineBefore(clock.now())),
    );
    let autoPicks = 0;
    let extensions = 0;
    for (const draftId of due.ok ? due.value : []) {
      await withDraft<void, CardNoLongerOwned>(draftId, async (services, draft, now) => {
        const ctx = await contextFor(services, draft, now);
        const outcome = runTableTimers(draft, ctx, choosingWith(ctx.cards));
        autoPicks += outcome.autoPicks.length;
        extensions += outcome.extensions;
        return save(services, draft, outcome.draft, now);
      });
    }
    return { drafts: due.ok ? due.value.length : 0, autoPicks, extensions };
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

  /** The draft as this player may see it (design doc 18, section 4), or null if there's none. */
  async function view(actor: Actor, draftId: DraftId): Promise<DraftSeen | null> {
    const seen = await unitOfWork.run<DraftSeen | null, never>(async (services) => {
      const draft = await services.drafts.find(draftId);
      if (draft === null) return ok(null);
      const ctx = await contextFor(services, draft, clock.now());
      return ok(visibleTo(draft, seatOf(draft, actor.userId)?.seatNumber ?? null, ctx));
    });
    return seen.ok ? seen.value : null;
  }

  return {
    createDraft,
    joinDraft,
    leaveDraft,
    startDraft,
    makePick,
    decideCard,
    chooseColor,
    peekWithSneak,
    watchWithInformant,
    answerDeal,
    endDeals,
    pickForAway,
    markPresence,
    runTimers,
    makeDraftDeck,
    addBot,
    removeBot,
    view,
  };
}

export type Drafts = ReturnType<typeof makeDrafts>;
