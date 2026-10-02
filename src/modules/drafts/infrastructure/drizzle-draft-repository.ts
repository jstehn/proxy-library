import { and, asc, eq, lte, or } from "drizzle-orm";
import { z } from "zod";
import { PrintingId, SetCode } from "@/modules/catalog";
import type { DeckId } from "@/modules/decks";
import type { DbExecutor } from "@/shared/db";
import { Cents, UserId } from "@/shared/kernel";
import type { DraftRepository } from "../application/ports";
import {
  DraftId,
  isUnfinished,
  type CardPick,
  type Draft,
  type DraftCard,
  type DraftPack,
  type NewDraft,
  type Reveal,
  type Seat,
} from "../domain/draft";
import { DRAFT_STYLE_NAMES } from "../domain/style";
import { draftBasics, draftCards, draftPacks, draftReveals, drafts, draftSeats } from "./schema";

// The draft aggregate in Postgres (design docs 17 and 18): rows for the table, seats, packs,
// cards, dealt basics and reveals, with the abilities' state as JSON parsed back with Zod.

const StatusSchema = z.enum(["lobby", "drafting", "dealing", "finished", "cancelled"]);
const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);
const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);
const PickStateSchema = z.enum([
  "faceDown",
  "faceUp",
  "removedFaceDown",
  "removedFaceUp",
  "returned",
]);
const CardRefSchema = z.object({ packNumber: z.number().int(), slot: z.number().int() });

const NoteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count"), value: z.number() }),
  z.object({ kind: z.literal("passedBy"), seat: z.number().nullable() }),
  z.object({
    kind: z.literal("colors"),
    choosers: z.array(z.number()),
    colors: z.array(ColorSchema),
  }),
  z.object({ kind: z.literal("name"), name: z.string(), from: CardRefSchema }),
  z.object({ kind: z.literal("types"), types: z.array(z.string()), from: CardRefSchema }),
  z.object({
    kind: z.literal("guess"),
    guess: z.string().nullable(),
    actual: z.string().nullable(),
  }),
  z.object({ kind: z.literal("randomDrafted"), count: z.number() }),
]);

const TurnSchema = z.object({
  packNumber: z.number(),
  extraCards: z.number(),
  librarians: z.array(CardRefSchema),
  operatives: z.array(CardRefSchema),
  agent: CardRefSchema.nullable(),
});

/** A seat saved before abilities existed has `{}`: every field has its starting value. */
const AbilitiesSchema = z.object({
  skipPacks: z.number().default(0),
  lockedOutRound: z.number().nullable().default(null),
  turn: TurnSchema.nullable().default(null),
  armedSearchers: z.array(CardRefSchema).default([]),
  awaitingChoices: CardRefSchema.nullable().default(null),
});

const WatcherSchema = z.object({
  kind: z.enum(["spy", "guess"]),
  seat: z.number(),
  card: CardRefSchema,
});

const PlayerWatchSchema = z.object({
  watcherSeat: z.number(),
  targetSeat: z.number(),
  card: CardRefSchema,
});

const DealSchema = z.object({
  brokerSeat: z.number(),
  brokerCard: CardRefSchema,
  stage: z.enum(["reveal", "offers", "accept"]),
  revealed: CardRefSchema.nullable(),
  offers: z.array(z.object({ seat: z.number(), card: CardRefSchema.nullable() })),
  // JSON has no dates: an ISO string comes back as a Date.
  deadline: z.coerce.date().nullable(),
});

const DealsSchema = z.object({ current: DealSchema.nullable(), waiting: z.array(DealSchema) });

const ShownCardsSchema = z.array(z.object({ printingId: z.string(), finish: FinishSchema }));

const RevealKindSchema = z.enum([
  "revealed",
  "removed",
  "guessed",
  "spied",
  "informed",
  "peeked",
  "passedOn",
  "dealt",
]);

type SeatRow = typeof draftSeats.$inferSelect;
type CardRow = typeof draftCards.$inferSelect;

const sameTime = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function seatFromRow(row: SeatRow): Seat {
  return {
    userId: UserId.of(row.userId),
    botNumber: row.botNumber === 0 ? null : row.botNumber,
    seatNumber: row.seatNumber,
    feePaid: Cents.of(row.feePaidCents),
    joinedAt: row.joinedAt,
    packSource: { kind: "entryFee" },
    deadline: row.deadline,
    deadlinePack: row.deadlinePack,
    deadlinePick: row.deadlinePick,
    promptDeadline: row.promptDeadline,
    graceUsedSeconds: row.graceUsedSeconds,
    lastSeenAt: row.lastSeenAt,
    abilities: AbilitiesSchema.parse(row.abilities),
  };
}

/** The seat columns that can change once the seat exists. */
function seatColumns(seat: Seat, isActive: boolean) {
  return {
    seatNumber: seat.seatNumber,
    feePaidCents: seat.feePaid,
    joinedAt: seat.joinedAt,
    packSource: seat.packSource.kind,
    deadline: seat.deadline,
    deadlinePack: seat.deadlinePack,
    deadlinePick: seat.deadlinePick,
    promptDeadline: seat.promptDeadline,
    graceUsedSeconds: seat.graceUsedSeconds,
    lastSeenAt: seat.lastSeenAt,
    abilities: seat.abilities,
    isActive,
  };
}

function seatRow(draftId: DraftId, seat: Seat, isActive: boolean) {
  return {
    draftId,
    userId: seat.userId,
    botNumber: seat.botNumber ?? 0,
    ...seatColumns(seat, isActive),
  };
}

/** A seat's key: user ids repeat (an admin and their bots), user + bot number doesn't. */
const seatKey = (seat: Seat) => `${seat.userId}/${seat.botNumber ?? 0}`;

/** The SQL condition for one seat's row. */
const isSeat = (draftId: DraftId, seat: Seat) =>
  and(
    eq(draftSeats.draftId, draftId),
    eq(draftSeats.userId, seat.userId),
    eq(draftSeats.botNumber, seat.botNumber ?? 0),
  );

function seatChanged(before: Seat, after: Seat): boolean {
  return (
    before.seatNumber !== after.seatNumber ||
    before.deadlinePack !== after.deadlinePack ||
    before.deadlinePick !== after.deadlinePick ||
    before.graceUsedSeconds !== after.graceUsedSeconds ||
    !sameTime(before.deadline, after.deadline) ||
    !sameTime(before.promptDeadline, after.promptDeadline) ||
    !sameTime(before.lastSeenAt, after.lastSeenAt) ||
    !sameJson(before.abilities, after.abilities)
  );
}

function pickFromRow(row: CardRow): CardPick | null {
  if (row.pickedBySeat === null || row.pickNumber === null || row.pickedAt === null) return null;
  return {
    seat: row.pickedBySeat,
    pickNumber: row.pickNumber,
    auto: row.pickedAuto,
    at: row.pickedAt,
    round: row.pickRound ?? 1,
    random: row.pickedRandom,
    state: PickStateSchema.parse(row.pickState ?? "faceDown"),
    poolSeat: row.poolSeat ?? row.pickedBySeat,
    notes: z.array(NoteSchema).parse(row.notes),
  };
}

function cardFromRow(row: CardRow): DraftCard {
  return {
    slot: row.slot,
    printingId: PrintingId.of(row.printingId),
    finish: FinishSchema.parse(row.finish),
    pick: pickFromRow(row),
    cameFrom: row.cameFrom === null ? null : CardRefSchema.parse(row.cameFrom),
  };
}

/** The pick columns of a card row (all empty for a card nobody has drafted). */
function pickColumns(card: DraftCard) {
  const pick = card.pick;
  return {
    pickedBySeat: pick?.seat ?? null,
    pickNumber: pick?.pickNumber ?? null,
    pickedAuto: pick?.auto ?? false,
    pickedAt: pick?.at ?? null,
    pickRound: pick?.round ?? null,
    pickedRandom: pick?.random ?? false,
    pickState: pick?.state ?? null,
    poolSeat: pick?.poolSeat ?? null,
    notes: pick?.notes ?? [],
  };
}

function cardRow(draftId: DraftId, packNumber: number, card: DraftCard) {
  return {
    draftId,
    packNumber,
    slot: card.slot,
    printingId: card.printingId,
    finish: card.finish,
    cameFrom: card.cameFrom,
    ...pickColumns(card),
  };
}

function packRow(draftId: DraftId, pack: DraftPack) {
  return {
    draftId,
    packNumber: pack.packNumber,
    round: pack.round,
    openedBySeat: pack.openedBySeat,
    seed: pack.seed,
    holderSeat: pack.holderSeat,
    queuePosition: pack.queuePosition,
    lastPassedBy: pack.lastPassedBy,
    addedBy: pack.addedBy,
    watchers: pack.watchers,
  };
}

export function drizzleDraftRepository(db: DbExecutor): DraftRepository {
  async function create(draft: NewDraft): Promise<DraftId> {
    const [row] = await db
      .insert(drafts)
      .values({
        hostId: draft.hostId,
        setCode: draft.setCode,
        boosterType: draft.boosterType,
        style: draft.style,
        status: draft.status,
        maxSeats: draft.maxSeats,
        secondsPerPick: draft.timer.kind === "on" ? draft.timer.secondsPerPick : null,
        entryFeeCents: draft.entryFee,
        round: draft.round,
        sequence: draft.sequence,
        version: draft.version,
        createdAt: draft.createdAt,
        startedAt: draft.startedAt,
        finishedAt: draft.finishedAt,
      })
      .returning({ id: drafts.id });
    const id = DraftId.of(row.id);
    if (draft.seats.length > 0) {
      await db.insert(draftSeats).values(draft.seats.map((seat) => seatRow(id, seat, true)));
    }
    return id;
  }

  async function load(draftId: DraftId, forUpdate: boolean): Promise<Draft | null> {
    const query = db.select().from(drafts).where(eq(drafts.id, draftId));
    const [row] = forUpdate ? await query.for("update") : await query;
    if (row === undefined) return null;
    const seats = await db.select().from(draftSeats).where(eq(draftSeats.draftId, draftId));
    const basics = await db
      .select()
      .from(draftBasics)
      .where(eq(draftBasics.draftId, draftId))
      .orderBy(asc(draftBasics.position));
    const packs = await db
      .select()
      .from(draftPacks)
      .where(eq(draftPacks.draftId, draftId))
      .orderBy(asc(draftPacks.packNumber));
    const cards = await db
      .select()
      .from(draftCards)
      .where(eq(draftCards.draftId, draftId))
      .orderBy(asc(draftCards.packNumber), asc(draftCards.slot));
    const reveals = await db
      .select()
      .from(draftReveals)
      .where(eq(draftReveals.draftId, draftId))
      .orderBy(asc(draftReveals.position));

    const cardsByPack = new Map<number, DraftCard[]>();
    for (const card of cards) {
      const list = cardsByPack.get(card.packNumber) ?? [];
      list.push(cardFromRow(card));
      cardsByPack.set(card.packNumber, list);
    }
    return {
      id: DraftId.of(row.id),
      hostId: UserId.of(row.hostId),
      setCode: SetCode.of(row.setCode),
      boosterType: row.boosterType,
      style: z.enum(DRAFT_STYLE_NAMES).parse(row.style),
      status: StatusSchema.parse(row.status),
      maxSeats: row.maxSeats,
      timer:
        row.secondsPerPick === null
          ? { kind: "off" }
          : { kind: "on", secondsPerPick: row.secondsPerPick },
      entryFee: Cents.of(row.entryFeeCents),
      round: row.round,
      sequence: row.sequence,
      seats: seats.map(seatFromRow).sort((a, b) => a.seatNumber - b.seatNumber),
      packs: packs.map((pack): DraftPack => ({
        packNumber: pack.packNumber,
        round: pack.round,
        openedBySeat: pack.openedBySeat,
        seed: pack.seed,
        holderSeat: pack.holderSeat,
        queuePosition: pack.queuePosition,
        cards: cardsByPack.get(pack.packNumber) ?? [],
        lastPassedBy: pack.lastPassedBy,
        addedBy: pack.addedBy,
        watchers: z.array(WatcherSchema).parse(pack.watchers),
      })),
      basicsHandedOut: basics.map((basic) => ({
        userId: UserId.of(basic.userId),
        printingId: PrintingId.of(basic.printingId),
        finish: FinishSchema.parse(basic.finish),
      })),
      watches: z.array(PlayerWatchSchema).parse(row.watches),
      reveals: reveals.map((reveal): Reveal => ({
        at: reveal.at,
        audience: reveal.audience,
        seat: reveal.seat,
        kind: RevealKindSchema.parse(reveal.kind),
        cards: ShownCardsSchema.parse(reveal.cards).map((card) => ({
          printingId: PrintingId.of(card.printingId),
          finish: card.finish,
        })),
        about: reveal.about === null ? null : CardRefSchema.parse(reveal.about),
      })),
      deals: row.deals === null ? null : DealsSchema.parse(row.deals),
      version: row.version,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    };
  }

  const lock = (draftId: DraftId) => load(draftId, true);
  const find = (draftId: DraftId) => load(draftId, false);

  async function saveSeats(before: Draft, after: Draft): Promise<void> {
    const isActive = isUnfinished(after);
    const activeChanged = isActive !== isUnfinished(before);
    const previous = new Map(before.seats.map((seat) => [seatKey(seat), seat]));
    const current = new Set(after.seats.map(seatKey));

    for (const seat of before.seats) {
      if (!current.has(seatKey(seat))) await db.delete(draftSeats).where(isSeat(after.id, seat));
    }
    for (const seat of after.seats) {
      const old = previous.get(seatKey(seat));
      if (old === undefined) {
        await db.insert(draftSeats).values(seatRow(after.id, seat, isActive));
      } else if (activeChanged || seatChanged(old, seat)) {
        await db.update(draftSeats).set(seatColumns(seat, isActive)).where(isSeat(after.id, seat));
      }
    }
  }

  async function savePacks(before: Draft, after: Draft): Promise<void> {
    const previous = new Map(before.packs.map((pack) => [pack.packNumber, pack]));
    const newPacks = after.packs.filter((pack) => !previous.has(pack.packNumber));
    if (newPacks.length > 0) {
      // The draft started, or a Lore Seeker added a pack: new packs and all their cards.
      await db.insert(draftPacks).values(newPacks.map((pack) => packRow(after.id, pack)));
      const cards = newPacks.flatMap((pack) =>
        pack.cards.map((card) => cardRow(after.id, pack.packNumber, card)),
      );
      if (cards.length > 0) await db.insert(draftCards).values(cards);
    }

    for (const pack of after.packs) {
      const old = previous.get(pack.packNumber);
      if (old === undefined) continue;
      if (
        old.holderSeat !== pack.holderSeat ||
        old.queuePosition !== pack.queuePosition ||
        old.lastPassedBy !== pack.lastPassedBy ||
        !sameJson(old.watchers, pack.watchers)
      ) {
        await db
          .update(draftPacks)
          .set({
            holderSeat: pack.holderSeat,
            queuePosition: pack.queuePosition,
            lastPassedBy: pack.lastPassedBy,
            watchers: pack.watchers,
          })
          .where(and(eq(draftPacks.draftId, after.id), eq(draftPacks.packNumber, pack.packNumber)));
      }
      const oldCards = new Map(old.cards.map((card) => [card.slot, card]));
      for (const card of pack.cards) {
        const was = oldCards.get(card.slot);
        if (was === undefined) {
          // A Cogwork Librarian put into this pack.
          await db.insert(draftCards).values(cardRow(after.id, pack.packNumber, card));
        } else if (!sameJson(was.pick, card.pick)) {
          await db
            .update(draftCards)
            .set(pickColumns(card))
            .where(
              and(
                eq(draftCards.draftId, after.id),
                eq(draftCards.packNumber, pack.packNumber),
                eq(draftCards.slot, card.slot),
              ),
            );
        }
      }
    }
  }

  async function save(before: Draft, after: Draft): Promise<void> {
    if (before.id !== after.id) throw new Error("save needs two versions of the same draft");
    await db
      .update(drafts)
      .set({
        status: after.status,
        round: after.round,
        sequence: after.sequence,
        version: after.version,
        startedAt: after.startedAt,
        finishedAt: after.finishedAt,
        watches: after.watches,
        deals: after.deals,
        dealDeadline: after.deals?.current?.deadline ?? null,
      })
      .where(eq(drafts.id, after.id));
    await saveSeats(before, after);
    await savePacks(before, after);
    const newBasics = after.basicsHandedOut.slice(before.basicsHandedOut.length);
    if (newBasics.length > 0) {
      await db.insert(draftBasics).values(
        newBasics.map((basic, index) => ({
          draftId: after.id,
          position: before.basicsHandedOut.length + index,
          ...basic,
        })),
      );
    }
    const newReveals = after.reveals.slice(before.reveals.length);
    if (newReveals.length > 0) {
      await db.insert(draftReveals).values(
        newReveals.map((reveal, index) => ({
          draftId: after.id,
          position: before.reveals.length + index,
          at: reveal.at,
          audience: reveal.audience,
          seat: reveal.seat,
          kind: reveal.kind,
          cards: reveal.cards,
          about: reveal.about,
        })),
      );
    }
  }

  async function activeDraftOf(userId: UserId): Promise<DraftId | null> {
    const [row] = await db
      .select({ draftId: draftSeats.draftId })
      .from(draftSeats)
      .where(
        and(
          eq(draftSeats.userId, userId),
          eq(draftSeats.botNumber, 0),
          eq(draftSeats.isActive, true),
        ),
      )
      .limit(1);
    return row === undefined ? null : DraftId.of(row.draftId);
  }

  async function lobbiesWith(userId: UserId): Promise<DraftId[]> {
    const rows = await db
      .select({ draftId: draftSeats.draftId })
      .from(draftSeats)
      .innerJoin(drafts, eq(drafts.id, draftSeats.draftId))
      .where(
        and(eq(draftSeats.userId, userId), eq(draftSeats.botNumber, 0), eq(drafts.status, "lobby")),
      )
      .orderBy(asc(draftSeats.draftId));
    return rows.map((row) => DraftId.of(row.draftId));
  }

  /** Drafts with something overdue: a pick, an owed color, or a deal step. */
  async function withDeadlineBefore(now: Date): Promise<DraftId[]> {
    const seatsDue = await db
      .selectDistinct({ draftId: draftSeats.draftId })
      .from(draftSeats)
      .innerJoin(drafts, eq(drafts.id, draftSeats.draftId))
      .where(
        and(
          eq(drafts.status, "drafting"),
          or(lte(draftSeats.deadline, now), lte(draftSeats.promptDeadline, now)),
        ),
      );
    const dealsDue = await db
      .select({ draftId: drafts.id })
      .from(drafts)
      .where(and(eq(drafts.status, "dealing"), lte(drafts.dealDeadline, now)));
    const ids = new Set([...seatsDue, ...dealsDue].map((row) => row.draftId));
    return [...ids].sort((a, b) => a - b).map((id) => DraftId.of(id));
  }

  async function setDeckOf(draftId: DraftId, userId: UserId, deckId: DeckId): Promise<void> {
    await db
      .update(draftSeats)
      .set({ deckId })
      .where(
        and(
          eq(draftSeats.draftId, draftId),
          eq(draftSeats.userId, userId),
          eq(draftSeats.botNumber, 0),
        ),
      );
  }

  return {
    create,
    lock,
    find,
    save,
    activeDraftOf,
    lobbiesWith,
    withDeadlineBefore,
    setDeckOf,
  };
}
