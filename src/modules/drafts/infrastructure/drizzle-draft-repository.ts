import { and, asc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { PrintingId, SetCode } from "@/modules/catalog";
import type { DeckId } from "@/modules/decks";
import type { DbExecutor } from "@/shared/db";
import { Cents, UserId } from "@/shared/kernel";
import type { DraftRepository } from "../application/ports";
import {
  DraftId,
  isUnfinished,
  type Draft,
  type DraftCard,
  type DraftPack,
  type NewDraft,
  type Seat,
} from "../domain/draft";
import { DRAFT_STYLE_NAMES } from "../domain/style";
import { draftCards, draftPacks, drafts, draftSeats } from "./schema";

const StatusSchema = z.enum(["lobby", "drafting", "finished", "cancelled"]);
const FinishSchema = z.enum(["nonfoil", "foil", "etched"]);

type SeatRow = typeof draftSeats.$inferSelect;
type CardRow = typeof draftCards.$inferSelect;

const sameTime = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

function seatFromRow(row: SeatRow): Seat {
  return {
    userId: UserId.of(row.userId),
    seatNumber: row.seatNumber,
    feePaid: Cents.of(row.feePaidCents),
    joinedAt: row.joinedAt,
    packSource: { kind: "entryFee" },
    deadline: row.deadline,
    deadlinePack: row.deadlinePack,
    graceUsedSeconds: row.graceUsedSeconds,
    lastSeenAt: row.lastSeenAt,
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
    graceUsedSeconds: seat.graceUsedSeconds,
    lastSeenAt: seat.lastSeenAt,
    isActive,
  };
}

function seatRow(draftId: DraftId, seat: Seat, isActive: boolean) {
  return { draftId, userId: seat.userId, ...seatColumns(seat, isActive) };
}

function cardFromRow(row: CardRow): DraftCard {
  const picked =
    row.pickedBySeat !== null && row.pickNumber !== null && row.pickedAt !== null
      ? {
          seat: row.pickedBySeat,
          pickNumber: row.pickNumber,
          auto: row.pickedAuto,
          at: row.pickedAt,
        }
      : null;
  return {
    slot: row.slot,
    printingId: PrintingId.of(row.printingId),
    finish: FinishSchema.parse(row.finish),
    pick: picked,
  };
}

function seatChanged(before: Seat, after: Seat): boolean {
  return (
    before.seatNumber !== after.seatNumber ||
    before.deadlinePack !== after.deadlinePack ||
    before.graceUsedSeconds !== after.graceUsedSeconds ||
    !sameTime(before.deadline, after.deadline) ||
    !sameTime(before.lastSeenAt, after.lastSeenAt)
  );
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

  async function lock(draftId: DraftId): Promise<Draft | null> {
    const [row] = await db.select().from(drafts).where(eq(drafts.id, draftId)).for("update");
    if (row === undefined) return null;
    const seats = await db.select().from(draftSeats).where(eq(draftSeats.draftId, draftId));
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
      })),
      version: row.version,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    };
  }

  async function saveSeats(before: Draft, after: Draft): Promise<void> {
    const isActive = isUnfinished(after);
    const activeChanged = isActive !== isUnfinished(before);
    const previous = new Map(before.seats.map((seat) => [seat.userId, seat]));
    const current = new Set(after.seats.map((seat) => seat.userId));

    for (const seat of before.seats) {
      if (!current.has(seat.userId)) {
        await db
          .delete(draftSeats)
          .where(and(eq(draftSeats.draftId, after.id), eq(draftSeats.userId, seat.userId)));
      }
    }
    for (const seat of after.seats) {
      const old = previous.get(seat.userId);
      if (old === undefined) {
        await db.insert(draftSeats).values(seatRow(after.id, seat, isActive));
      } else if (activeChanged || seatChanged(old, seat)) {
        await db
          .update(draftSeats)
          .set(seatColumns(seat, isActive))
          .where(and(eq(draftSeats.draftId, after.id), eq(draftSeats.userId, seat.userId)));
      }
    }
  }

  async function savePacks(before: Draft, after: Draft): Promise<void> {
    if (before.packs.length === 0 && after.packs.length > 0) {
      // The draft just started: every pack and card is new.
      await db.insert(draftPacks).values(
        after.packs.map((pack) => ({
          draftId: after.id,
          packNumber: pack.packNumber,
          round: pack.round,
          openedBySeat: pack.openedBySeat,
          seed: pack.seed,
          holderSeat: pack.holderSeat,
          queuePosition: pack.queuePosition,
        })),
      );
      const cards = after.packs.flatMap((pack) =>
        pack.cards.map((card) => ({
          draftId: after.id,
          packNumber: pack.packNumber,
          slot: card.slot,
          printingId: card.printingId,
          finish: card.finish,
        })),
      );
      if (cards.length > 0) await db.insert(draftCards).values(cards);
      return;
    }

    const previous = new Map(before.packs.map((pack) => [pack.packNumber, pack]));
    for (const pack of after.packs) {
      const old = previous.get(pack.packNumber);
      if (old === undefined) throw new Error(`pack ${pack.packNumber} appeared mid-draft`);
      if (old.holderSeat !== pack.holderSeat || old.queuePosition !== pack.queuePosition) {
        await db
          .update(draftPacks)
          .set({ holderSeat: pack.holderSeat, queuePosition: pack.queuePosition })
          .where(and(eq(draftPacks.draftId, after.id), eq(draftPacks.packNumber, pack.packNumber)));
      }
      for (const card of pack.cards) {
        const wasPicked = old.cards.find((each) => each.slot === card.slot)?.pick ?? null;
        if (card.pick === null || wasPicked !== null) continue;
        await db
          .update(draftCards)
          .set({
            pickedBySeat: card.pick.seat,
            pickNumber: card.pick.pickNumber,
            pickedAuto: card.pick.auto,
            pickedAt: card.pick.at,
          })
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
      })
      .where(eq(drafts.id, after.id));
    await saveSeats(before, after);
    await savePacks(before, after);
  }

  async function activeDraftOf(userId: UserId): Promise<DraftId | null> {
    const [row] = await db
      .select({ draftId: draftSeats.draftId })
      .from(draftSeats)
      .where(and(eq(draftSeats.userId, userId), eq(draftSeats.isActive, true)))
      .limit(1);
    return row === undefined ? null : DraftId.of(row.draftId);
  }

  async function lobbiesWith(userId: UserId): Promise<DraftId[]> {
    const rows = await db
      .select({ draftId: draftSeats.draftId })
      .from(draftSeats)
      .innerJoin(drafts, eq(drafts.id, draftSeats.draftId))
      .where(and(eq(draftSeats.userId, userId), eq(drafts.status, "lobby")))
      .orderBy(asc(draftSeats.draftId));
    return rows.map((row) => DraftId.of(row.draftId));
  }

  async function withDeadlineBefore(now: Date): Promise<DraftId[]> {
    const rows = await db
      .selectDistinct({ draftId: draftSeats.draftId })
      .from(draftSeats)
      .innerJoin(drafts, eq(drafts.id, draftSeats.draftId))
      .where(and(eq(drafts.status, "drafting"), lte(draftSeats.deadline, now)))
      .orderBy(asc(draftSeats.draftId));
    return rows.map((row) => DraftId.of(row.draftId));
  }

  async function setDeckOf(draftId: DraftId, userId: UserId, deckId: DeckId): Promise<void> {
    await db
      .update(draftSeats)
      .set({ deckId })
      .where(and(eq(draftSeats.draftId, draftId), eq(draftSeats.userId, userId)));
  }

  return { create, lock, save, activeDraftOf, lobbiesWith, withDeadlineBefore, setDeckOf };
}
