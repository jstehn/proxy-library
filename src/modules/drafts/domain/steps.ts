import { err, ok, randomInt, shuffled, type Result, type Rng } from "@/shared/kernel";
import {
  abilityOf,
  COLORS,
  creatureTypes,
  isCreatureLine,
  sameCard,
  type CardAbility,
  type CardRef,
  type DraftAbility,
  type Note,
} from "./abilities";
import type { FactsLookup } from "./auto-pick";
import {
  beginRound,
  cardAt,
  cardsLeft,
  currentPack,
  draftedBy,
  isLastRound,
  newPack,
  queueOf,
  refOf,
  refreshDeadlines,
  reveal,
  roundIsOver,
  seatAt,
  withAbilities,
  withCard,
  withPack,
  type Deal,
  type Draft,
  type DraftCard,
  type HandedOutBasic,
  type OpenedPack,
  type Turn,
} from "./draft";
import type {
  AbilityUnavailable,
  AwaitingChoices,
  ChooseColorsFirst,
  DraftNotRunning,
  MustDraftAtRandom,
  StalePick,
} from "./errors";
import { DRAFT_STYLES, passTarget } from "./style";

// Drafting one card at a time (design doc 18, section 7). A seat's turn with a pack is made of
// steps: choose a card (or draw one at random), apply that card's own draft text, apply the
// player's choices about it, then either keep the pack (extra cards owed, the whole pack) or end
// the turn and pass it. After every change the table settles: packs reaching seats that must skip
// pass straight on, rounds end, and deadlines move.

/** What the engine needs from outside: the time, what each printing is, and randomness. */
export type StepContext = Readonly<{ now: Date; cards: FactsLookup; rng: Rng }>;

/** A Lore Seeker's added pack, already opened, its basics already dealt (design doc 17, rule 15). */
export type AddedPack = Readonly<{ pack: OpenedPack; basics: readonly HandedOutBasic[] }>;

/** The player's choices about the card they're drafting. Every one is optional. */
export type StepChoices = Readonly<{
  /** Cogwork Grinder (face down) or Animus of Predation (face up). */
  remove?: "faceDown" | "faceUp";
  /** Face-up Noble Bannerets, Paliano Vanguards or Smuggler Captains to note this card with. */
  noteWith?: readonly CardRef[];
  /** How many face-up Cogwork Librarians / Leovold's Operatives to use: one extra card each. */
  librarians?: number;
  operatives?: number;
  /** Agent of Acquisitions: take the whole pack (only as the first card of a turn). */
  wholePack?: boolean;
  /** Spire Phantasm: the name of the card you guess will be drafted next from this pack. */
  guess?: string;
  /** Lore Seeker: the pack to add. */
  addPack?: AddedPack;
  /** Where a last card goes when several players drafted a Canal Dredger. */
  lastCardTo?: number;
}>;

export type StepInput = Readonly<{
  seatNumber: number;
  packNumber: number;
  /** A slot of the pack in front, or "random" while an Archdemon of Paliano is face up. */
  slot: number | "random";
  auto: boolean;
  choices?: StepChoices;
}>;

export type StepError =
  | DraftNotRunning
  | StalePick
  | AwaitingChoices
  | ChooseColorsFirst
  | MustDraftAtRandom
  | AbilityUnavailable;

const unavailable = (reason: string): AbilityUnavailable => ({
  kind: "AbilityUnavailable",
  reason,
});

export function abilityOfCard(
  ctx: StepContext,
  card: Pick<DraftCard, "printingId">,
): CardAbility | null {
  return abilityOf(ctx.cards(card.printingId)?.name);
}

/** A seat's face-up cards with a given ability, in the order drafted. */
export function faceUpWith(
  draft: Draft,
  seatNumber: number,
  kind: DraftAbility["kind"],
  ctx: StepContext,
): CardRef[] {
  return draft.packs
    .flatMap((pack) => pack.cards.map((card) => ({ pack, card })))
    .filter(
      ({ card }) =>
        card.pick?.seat === seatNumber &&
        card.pick.state === "faceUp" &&
        abilityOfCard(ctx, card)?.ability.kind === kind,
    )
    .sort((a, b) => (a.card.pick?.pickNumber ?? 0) - (b.card.pick?.pickNumber ?? 0))
    .map(({ pack, card }) => refOf(pack, card));
}

/** The seats with a face-up Canal Dredger: the last card of every pack goes to one of them. */
export function dredgerSeats(draft: Draft, ctx: StepContext): number[] {
  return draft.seats
    .map((seat) => seat.seatNumber)
    .filter((seat) => faceUpWith(draft, seat, "lastCards", ctx).length > 0);
}

/** The color choice a seat owes now (Paliano, Regicide), if any. */
export function owedColor(
  draft: Draft,
  seatNumber: number,
): { card: CardRef; note: Extract<Note, { kind: "colors" }> } | null {
  for (const pack of draft.packs) {
    for (const card of pack.cards) {
      for (const note of card.pick?.notes ?? []) {
        if (note.kind === "colors" && note.choosers[note.colors.length] === seatNumber) {
          return { card: refOf(pack, card), note };
        }
      }
    }
  }
  return null;
}

const pickNumberOf = (draft: Draft, ref: CardRef) => cardAt(draft, ref)?.pick?.pickNumber ?? 0;

function addNote(draft: Draft, ref: CardRef, note: Note): Draft {
  return withCard(draft, ref, (card) =>
    card.pick === null
      ? card
      : { ...card, pick: { ...card.pick, notes: [...card.pick.notes, note] } },
  );
}

function replaceNote(
  draft: Draft,
  ref: CardRef,
  kind: Note["kind"],
  change: (note: Note) => Note,
): Draft {
  return withCard(draft, ref, (card) =>
    card.pick === null
      ? card
      : {
          ...card,
          pick: {
            ...card.pick,
            notes: card.pick.notes.map((note) => (note.kind === kind ? change(note) : note)),
          },
        },
  );
}

const turnFaceDown = (draft: Draft, ref: CardRef) =>
  withCard(draft, ref, (card) =>
    card.pick === null ? card : { ...card, pick: { ...card.pick, state: "faceDown" } },
  );

const shown = (card: DraftCard) => [{ printingId: card.printingId, finish: card.finish }];

/**
 * Drafts the card at `slot` of the seat's front pack: records the pick, does what the card itself
 * says as you draft it (reveal, notes), and lets anyone waiting for this card see it (Cogwork Spy,
 * Spire Phantasm, Illusionary Informant, Aether Searcher).
 */
function recordDraft(
  draft: Draft,
  seatNumber: number,
  packNumber: number,
  slot: number,
  how: { auto: boolean; random: boolean },
  ctx: StepContext,
): Draft {
  const pack = draft.packs.find((each) => each.packNumber === packNumber);
  const card = pack?.cards.find((each) => each.slot === slot);
  if (pack === undefined || card === undefined) throw new Error("recordDraft: no such card");
  const ref = refOf(pack, card);
  const ability = abilityOfCard(ctx, card);
  const facts = ctx.cards(card.printingId);
  const seatCount = draft.seats.length;
  const drafted = draftedBy(draft, seatNumber);

  const notes: Note[] = [];
  switch (ability?.ability.kind) {
    case "countNote":
      notes.push({
        kind: "count",
        value: drafted.filter((each) => each.pick?.round === draft.round).length + 1,
      });
      break;
    case "passerNote":
      notes.push({ kind: "passedBy", seat: pack.lastPassedBy });
      break;
    case "colorsNote":
      notes.push({
        kind: "colors",
        choosers: [
          passTarget(seatNumber, "right", seatCount),
          seatNumber,
          passTarget(seatNumber, "left", seatCount),
        ],
        colors: [],
      });
      break;
    case "random":
      notes.push({ kind: "randomDrafted", count: 0 });
      break;
  }

  let next = withCard(draft, ref, (each) => ({
    ...each,
    pick: {
      seat: seatNumber,
      pickNumber: drafted.length + 1,
      auto: how.auto,
      at: ctx.now,
      round: draft.round,
      random: how.random,
      state: ability?.faceUp ? "faceUp" : "faceDown",
      poolSeat: seatNumber,
      notes,
    },
  }));
  if (ability?.reveal) {
    next = reveal(next, {
      at: ctx.now,
      audience: null,
      seat: seatNumber,
      kind: "revealed",
      cards: shown(card),
      about: ref,
    });
  }

  // Whoever was waiting for the next card from this pack sees it now.
  for (const watcher of pack.watchers) {
    if (watcher.kind === "spy" && watcher.seat !== seatNumber) {
      next = reveal(next, {
        at: ctx.now,
        audience: watcher.seat,
        seat: seatNumber,
        kind: "spied",
        cards: shown(card),
        about: watcher.card,
      });
    }
    if (watcher.kind === "guess") {
      next = replaceNote(next, watcher.card, "guess", (note) =>
        note.kind === "guess" ? { ...note, actual: facts?.name ?? "Unknown card" } : note,
      );
      next = reveal(next, {
        at: ctx.now,
        audience: null,
        seat: seatNumber,
        kind: "guessed",
        cards: shown(card),
        about: watcher.card,
      });
    }
  }
  next = withPack(next, packNumber, (each) => ({ ...each, watchers: [] }));
  for (const watch of next.watches.filter((each) => each.targetSeat === seatNumber)) {
    next = reveal(next, {
      at: ctx.now,
      audience: watch.watcherSeat,
      seat: seatNumber,
      kind: "informed",
      cards: shown(card),
      about: watch.card,
    });
  }
  next = { ...next, watches: next.watches.filter((each) => each.targetSeat !== seatNumber) };

  // Aether Searchers drafted earlier note this card's name.
  const searchers = seatAt(next, seatNumber).abilities.armedSearchers;
  for (const searcher of searchers) {
    next = addNote(next, searcher, {
      kind: "name",
      name: facts?.name ?? "Unknown card",
      from: ref,
    });
    next = reveal(next, {
      at: ctx.now,
      audience: null,
      seat: seatNumber,
      kind: "revealed",
      cards: shown(card),
      about: searcher,
    });
  }
  next = withAbilities(next, seatNumber, (abilities) => ({
    ...abilities,
    armedSearchers: ability?.ability.kind === "nextCardName" ? [ref] : [],
  }));

  // Cogwork Spy: the next card drafted from this pack.
  if (ability?.ability.kind === "spy") {
    next = withPack(next, packNumber, (each) => ({
      ...each,
      watchers: [...each.watchers, { kind: "spy", seat: seatNumber, card: ref }],
    }));
  }
  return next;
}

/** Archdemon of Paliano: a card drafted at random counts toward every face-up one (rulings). */
function countRandomDraft(
  draft: Draft,
  seatNumber: number,
  drafted: CardRef,
  ctx: StepContext,
): Draft {
  let next = draft;
  for (const archdemon of faceUpWith(draft, seatNumber, "random", ctx)) {
    if (sameCard(archdemon, drafted)) continue;
    const card = cardAt(next, archdemon);
    const times = (() => {
      const ability = card === null ? null : abilityOfCard(ctx, card)?.ability;
      return ability?.kind === "random" ? ability.times : 3;
    })();
    const count =
      (
        card?.pick?.notes.find((note) => note.kind === "randomDrafted") as
          Extract<Note, { kind: "randomDrafted" }> | undefined
      )?.count ?? 0;
    next = replaceNote(next, archdemon, "randomDrafted", () => ({
      kind: "randomDrafted",
      count: count + 1,
    }));
    if (count + 1 >= times) next = turnFaceDown(next, archdemon);
  }
  return next;
}

/** Passes a pack on: its last card to a Canal Dredger drafter, else to the neighbor. */
function passPack(
  draft: Draft,
  packNumber: number,
  fromSeat: number,
  lastCardTo: number | undefined,
  ctx: StepContext,
): Draft {
  const pack = draft.packs.find((each) => each.packNumber === packNumber);
  if (pack === undefined || cardsLeft(pack) === 0) return draft;
  const dredgers = dredgerSeats(draft, ctx);
  let destination = passTarget(
    fromSeat,
    DRAFT_STYLES[draft.style].passDirection(draft.round),
    draft.seats.length,
  );
  if (cardsLeft(pack) === 1 && dredgers.length > 0) {
    destination =
      lastCardTo !== undefined && dredgers.includes(lastCardTo)
        ? lastCardTo
        : dredgers.includes(fromSeat)
          ? fromSeat
          : dredgers[0];
  }
  // Passed to yourself (Canal Dredger): you draft it next. Anyone else: to the back of their queue.
  const front = Math.min(0, ...queueOf(draft, destination).map((each) => each.queuePosition));
  const queuePosition = destination === fromSeat ? front - 1 : draft.sequence;
  return {
    ...withPack(draft, packNumber, (each) => ({
      ...each,
      holderSeat: destination,
      queuePosition,
      lastPassedBy: fromSeat,
    })),
    sequence: draft.sequence + 1,
  };
}

/**
 * Ends a seat's turn with a pack: Librarians go into it, Operatives and the Agent turn face down
 * (with their effects), and the pack is passed.
 */
function endTurn(
  draft: Draft,
  seatNumber: number,
  turn: Turn,
  lastCardTo: number | undefined,
  ctx: StepContext,
): Draft {
  let next = draft;
  for (const librarian of turn.librarians) {
    const card = cardAt(next, librarian);
    if (card === null) continue;
    next = withCard(next, librarian, (each) =>
      each.pick === null ? each : { ...each, pick: { ...each.pick, state: "returned" } },
    );
    next = withPack(next, turn.packNumber, (pack) => ({
      ...pack,
      cards: [
        ...pack.cards,
        {
          slot: Math.max(...pack.cards.map((each) => each.slot)) + 1,
          printingId: card.printingId,
          finish: card.finish,
          pick: null,
          cameFrom: librarian,
        },
      ],
    }));
  }
  for (const operative of turn.operatives) next = turnFaceDown(next, operative);
  if (turn.agent !== null) next = turnFaceDown(next, turn.agent);
  next = withAbilities(next, seatNumber, (abilities) => ({
    ...abilities,
    turn: null,
    skipPacks: abilities.skipPacks + turn.operatives.length,
    lockedOutRound: turn.agent !== null ? draft.round : abilities.lockedOutRound,
  }));
  return passPack(next, turn.packNumber, seatNumber, lastCardTo, ctx);
}

/** Applies the player's choices about the card at `ref`, then continues or ends their turn. */
function applyChoices(
  draft: Draft,
  seatNumber: number,
  ref: CardRef,
  choices: StepChoices,
  ctx: StepContext,
): Result<Draft, AbilityUnavailable> {
  const card = cardAt(draft, ref);
  if (card?.pick == null) throw new Error("applyChoices: the card isn't drafted");
  const facts = ctx.cards(card.printingId);
  const ability = abilityOfCard(ctx, card);
  const drafted = card.pick.pickNumber;
  const earlier = (refs: CardRef[]) => refs.filter((each) => pickNumberOf(draft, each) < drafted);
  let next = draft;

  // Remove it from the draft (Cogwork Grinder face down, Animus of Predation face up).
  if (choices.remove !== undefined) {
    const faceUp = choices.remove === "faceUp";
    const removers = earlier(faceUpWith(draft, seatNumber, "remove", ctx)).filter((each) => {
      const remover = cardAt(draft, each);
      const kind = remover === null ? null : abilityOfCard(ctx, remover)?.ability;
      return kind?.kind === "remove" && kind.faceUp === faceUp;
    });
    if (removers.length === 0)
      return err(unavailable(`no face-up ${faceUp ? "Animus of Predation" : "Cogwork Grinder"}`));
    next = withCard(next, ref, (each) =>
      each.pick === null
        ? each
        : { ...each, pick: { ...each.pick, state: faceUp ? "removedFaceUp" : "removedFaceDown" } },
    );
    if (faceUp)
      next = reveal(next, {
        at: ctx.now,
        audience: null,
        seat: seatNumber,
        kind: "removed",
        cards: shown(card),
        about: removers[0],
      });
  }

  // Note it with face-up Bannerets, Vanguards or Smuggler Captains, which then turn face down.
  for (const noter of choices.noteWith ?? []) {
    const noterCard = cardAt(next, noter);
    const kind = noterCard === null ? null : abilityOfCard(ctx, noterCard)?.ability;
    const usable =
      noterCard?.pick?.seat === seatNumber &&
      noterCard.pick.state === "faceUp" &&
      kind?.kind === "noteDrafted" &&
      pickNumberOf(draft, noter) < drafted &&
      (!kind.creaturesOnly || isCreatureLine(facts?.typeLine ?? ""));
    if (!usable || kind?.kind !== "noteDrafted")
      return err(unavailable("that card can't note this one"));
    next = addNote(
      next,
      noter,
      kind.what === "name"
        ? { kind: "name", name: facts?.name ?? "Unknown card", from: ref }
        : { kind: "types", types: creatureTypes(facts?.typeLine ?? ""), from: ref },
    );
    next = turnFaceDown(next, noter);
    next = reveal(next, {
      at: ctx.now,
      audience: null,
      seat: seatNumber,
      kind: "revealed",
      cards: shown(card),
      about: noter,
    });
  }

  const packNumber = ref.packNumber;
  const left = () => {
    const pack = next.packs.find((each) => each.packNumber === packNumber);
    return pack === undefined ? 0 : cardsLeft(pack);
  };

  // Spire Phantasm: guess the next card drafted from this pack (no game if it's empty).
  if (ability?.ability.kind === "guess") {
    next = addNote(next, ref, {
      kind: "guess",
      guess: choices.guess?.trim() || null,
      actual: null,
    });
    if (left() > 0) {
      next = withPack(next, packNumber, (pack) => ({
        ...pack,
        watchers: [...pack.watchers, { kind: "guess", seat: seatNumber, card: ref }],
      }));
    }
  }

  // Lore Seeker: the added pack is the seat's very next pick, drafted this round.
  if (ability?.ability.kind === "addPack" && choices.addPack !== undefined) {
    const front = Math.min(0, ...queueOf(next, seatNumber).map((pack) => pack.queuePosition));
    next = {
      ...next,
      packs: [
        ...next.packs,
        newPack(choices.addPack.pack, {
          packNumber: Math.max(...next.packs.map((pack) => pack.packNumber)) + 1,
          round: next.round,
          seat: seatNumber,
          queuePosition: front - 1,
          addedBy: seatNumber,
        }),
      ],
      basicsHandedOut: [...next.basicsHandedOut, ...choices.addPack.basics],
    };
  }

  // The turn: extra cards owed (Librarian, Operative) or the whole pack (Agent).
  const seat = seatAt(next, seatNumber);
  let turn: Turn = seat.abilities.turn ?? {
    packNumber,
    extraCards: 0,
    librarians: [],
    operatives: [],
    agent: null,
  };
  if (seat.abilities.turn === null) {
    if (choices.wholePack) {
      const agents = earlier(faceUpWith(draft, seatNumber, "wholePack", ctx));
      if (agents.length === 0) return err(unavailable("no face-up Agent of Acquisitions"));
      turn = { ...turn, agent: agents[0] };
    }
  } else if (turn.agent === null) {
    turn = { ...turn, extraCards: turn.extraCards - 1 }; // this card was one of the extras
  }
  for (const [count, then] of [
    [choices.librarians ?? 0, "intoPack"],
    [choices.operatives ?? 0, "skipPack"],
  ] as const) {
    if (count === 0) continue;
    if (turn.agent !== null) return err(unavailable("you're already drafting the whole pack"));
    const used = then === "intoPack" ? turn.librarians : turn.operatives;
    const available = earlier(faceUpWith(draft, seatNumber, "extraCard", ctx)).filter((each) => {
      const extra = cardAt(draft, each);
      const kind = extra === null ? null : abilityOfCard(ctx, extra)?.ability;
      return (
        kind?.kind === "extraCard" &&
        kind.then === then &&
        !used.some((usedRef) => sameCard(usedRef, each))
      );
    });
    if (available.length < count) return err(unavailable("not enough face-up cards for that"));
    if (left() < turn.extraCards + count)
      return err(unavailable("not enough cards left in the pack"));
    const chosen = available.slice(0, count);
    turn =
      then === "intoPack"
        ? {
            ...turn,
            extraCards: turn.extraCards + count,
            librarians: [...turn.librarians, ...chosen],
          }
        : {
            ...turn,
            extraCards: turn.extraCards + count,
            operatives: [...turn.operatives, ...chosen],
          };
  }

  const continues = left() > 0 && (turn.agent !== null || turn.extraCards > 0);
  if (continues)
    return ok(withAbilities(next, seatNumber, (abilities) => ({ ...abilities, turn })));
  return ok(endTurn(next, seatNumber, turn, choices.lastCardTo, ctx));
}

/** Who must pass on the pack in front of them: an Operative's skip, or the Agent's lockout. */
function mustPassOn(draft: Draft, seatNumber: number, ctx: StepContext): boolean {
  const seat = seatAt(draft, seatNumber);
  const front = currentPack(draft, seatNumber);
  if (front === null || seat.abilities.turn !== null || seat.abilities.awaitingChoices !== null)
    return false;
  const lockedOut = seat.abilities.lockedOutRound === draft.round;
  if (!lockedOut && seat.abilities.skipPacks === 0) return false;
  // Decision 3: a Canal Dredger drafter drafts a last card passed to them anyway.
  return !(cardsLeft(front) === 1 && dredgerSeats(draft, ctx).includes(seatNumber));
}

/** Packs the seat looks at and passes on without drafting (Leovold's Operative, Agent lockout). */
function passOnSkipped(draft: Draft, ctx: StepContext): Draft {
  let next = draft;
  const cardCount = draft.packs.reduce((sum, pack) => sum + pack.cards.length, 0);
  for (let guard = 0; guard <= cardCount * draft.seats.length; guard += 1) {
    const seat = next.seats.find((each) => mustPassOn(next, each.seatNumber, ctx));
    if (seat === undefined) break;
    const front = currentPack(next, seat.seatNumber);
    if (front === null) break;
    next = reveal(next, {
      at: ctx.now,
      audience: seat.seatNumber,
      seat: seat.seatNumber,
      kind: "passedOn",
      cards: front.cards.filter((card) => card.pick === null).flatMap(shown),
      about: null,
    });
    // A skip is used up by any pack passed on without drafting, even during a lockout.
    next = withAbilities(next, seat.seatNumber, (abilities) => ({
      ...abilities,
      skipPacks: Math.max(0, abilities.skipPacks - 1),
    }));
    next = passPack(next, front.packNumber, seat.seatNumber, undefined, ctx);
  }
  return next;
}

/** The Deal Brokers face up at the end of the draft, in a random order (CR 905.2a). */
function beginDeals(draft: Draft, ctx: StepContext): Draft {
  const brokers = draft.packs.flatMap((pack) =>
    pack.cards
      .filter(
        (card) =>
          card.pick?.state === "faceUp" && abilityOfCard(ctx, card)?.ability.kind === "dealAfter",
      )
      .map((card) => ({ seat: card.pick?.poolSeat ?? 0, ref: refOf(pack, card) })),
  );
  if (brokers.length === 0) return { ...draft, status: "finished", finishedAt: ctx.now };
  const deals = shuffled(ctx.rng, brokers).map((broker): Deal => ({
    brokerSeat: broker.seat,
    brokerCard: broker.ref,
    stage: "reveal",
    revealed: null,
    offers: [],
    deadline: null,
  }));
  const [first, ...waiting] = deals;
  return {
    ...draft,
    status: "dealing",
    deals: { current: dealDeadline(draft, first, ctx.now), waiting },
  };
}

/** A deal step gets the pick timer's time, or waits (timer off). */
export function dealDeadline(draft: Draft, deal: Deal, now: Date): Deal {
  return {
    ...deal,
    deadline:
      draft.timer.kind === "on"
        ? new Date(now.getTime() + draft.timer.secondsPerPick * 1000)
        : null,
  };
}

/**
 * After any change: pass on what must be passed on, end rounds (and the draft, once nobody owes a
 * color choice), and move deadlines.
 */
export function settleTable(draft: Draft, ctx: StepContext): Draft {
  let next = draft;
  for (let guard = 0; guard < 10 && next.status === "drafting"; guard += 1) {
    next = passOnSkipped(next, ctx);
    if (!roundIsOver(next)) break;
    if (!isLastRound(next)) {
      next = beginRound(next, next.round + 1);
      continue;
    }
    const owing = next.seats.some((seat) => owedColor(next, seat.seatNumber) !== null);
    if (!owing) next = beginDeals(next, ctx);
    break;
  }
  return refreshDeadlines(next, ctx.now, (table, seat) => owedColor(table, seat) !== null);
}

/** Drafts one card (a step of a turn); see the file comment. */
export function draftStep(
  draft: Draft,
  input: StepInput,
  ctx: StepContext,
): Result<{ draft: Draft; card: CardRef }, StepError> {
  if (draft.status !== "drafting") return err({ kind: "DraftNotRunning" });
  const seat = seatAt(draft, input.seatNumber);
  if (seat.abilities.awaitingChoices !== null) return err({ kind: "AwaitingChoices" });
  if (owedColor(draft, input.seatNumber) !== null) return err({ kind: "ChooseColorsFirst" });
  const pack = currentPack(draft, input.seatNumber);
  if (pack === null || pack.packNumber !== input.packNumber) return err({ kind: "StalePick" });

  const atRandom = faceUpWith(draft, input.seatNumber, "random", ctx).length > 0;
  if (atRandom && input.slot !== "random") return err({ kind: "MustDraftAtRandom" });
  if (!atRandom && input.slot === "random")
    return err(unavailable("no face-up Archdemon of Paliano"));
  const left = pack.cards.filter((card) => card.pick === null);
  const slot = input.slot === "random" ? left[randomInt(ctx.rng, left.length)].slot : input.slot;
  if (!left.some((card) => card.slot === slot)) return err({ kind: "StalePick" });

  let next = recordDraft(
    draft,
    input.seatNumber,
    pack.packNumber,
    slot,
    { auto: input.auto, random: atRandom },
    ctx,
  );
  const ref = { packNumber: pack.packNumber, slot };
  if (atRandom) {
    // You see the card only now; your choices about it come next (decideOnCard).
    next = countRandomDraft(next, input.seatNumber, ref, ctx);
    next = withAbilities(next, input.seatNumber, (abilities) => ({
      ...abilities,
      awaitingChoices: ref,
    }));
    return ok({ draft: { ...settleTable(next, ctx), version: draft.version + 1 }, card: ref });
  }
  const applied = applyChoices(next, input.seatNumber, ref, input.choices ?? {}, ctx);
  if (!applied.ok) return applied;
  return ok({
    draft: { ...settleTable(applied.value, ctx), version: draft.version + 1 },
    card: ref,
  });
}

/** The choices about a card drafted at random, once its drafter has seen it (Archdemon). */
export function decideOnCard(
  draft: Draft,
  seatNumber: number,
  choices: StepChoices,
  ctx: StepContext,
): Result<Draft, DraftNotRunning | AbilityUnavailable> {
  if (draft.status !== "drafting") return err({ kind: "DraftNotRunning" });
  const waiting = seatAt(draft, seatNumber).abilities.awaitingChoices;
  if (waiting === null) return err(unavailable("no card waiting for your choices"));
  const cleared = withAbilities(draft, seatNumber, (abilities) => ({
    ...abilities,
    awaitingChoices: null,
  }));
  const applied = applyChoices(cleared, seatNumber, waiting, choices, ctx);
  if (!applied.ok) return applied;
  return ok({ ...settleTable(applied.value, ctx), version: draft.version + 1 });
}

/** Chooses one of the colors a seat owes (Paliano, Regicide): right neighbor, drafter, left. */
export function chooseColor(
  draft: Draft,
  seatNumber: number,
  color: (typeof COLORS)[number],
  ctx: StepContext,
): Result<Draft, AbilityUnavailable> {
  const owed = owedColor(draft, seatNumber);
  if (owed === null) return err(unavailable("you don't owe a color choice"));
  if (owed.note.colors.includes(color))
    return err(unavailable("that color has been chosen already"));
  const next = replaceNote(draft, owed.card, "colors", (note) =>
    note.kind === "colors" ? { ...note, colors: [...note.colors, color] } : note,
  );
  return ok({ ...settleTable(next, ctx), version: draft.version + 1 });
}

/** A color nobody has chosen yet for that card, at random (bots and timeouts). */
export function randomColor(note: Extract<Note, { kind: "colors" }>, rng: Rng) {
  const open = COLORS.filter((color) => !note.colors.includes(color));
  return open[randomInt(rng, open.length)];
}

/** The draft as design doc 17 knew it: one card, no abilities. Kept for the plain-draft tests. */
export function applyPick(
  draft: Draft,
  input: Readonly<{ seatNumber: number; packNumber: number; slot: number; auto: boolean }>,
  now: Date,
  ctx: Omit<StepContext, "now"> = { cards: () => undefined, rng: { next: () => 0 } },
): Result<{ draft: Draft; card: DraftCard }, StepError> {
  const stepped = draftStep(draft, input, { ...ctx, now });
  if (!stepped.ok) return stepped;
  const card = cardAt(stepped.value.draft, stepped.value.card);
  if (card === null) throw new Error("applyPick: the drafted card vanished");
  return ok({ draft: stepped.value.draft, card });
}
