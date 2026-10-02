import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/shared/db";
import { Cents, type UserId } from "@/shared/kernel";
import { DRAFT_STYLE_NAMES, DRAFT_STYLES, DRAFTABLE_BOOSTER_TYPES } from "../domain/style";
import { AWAY_AFTER_SECONDS } from "../domain/timers";

// Read models for the draft screens (design doc 17, section 9). What a player may see is decided
// here: their own pack and picks, and only counts for everyone else (rule 13).

export type DraftStatusName = "lobby" | "drafting" | "finished" | "cancelled";

export type DraftSummary = Readonly<{
  id: number;
  setCode: string;
  setName: string;
  keyruneCode: string;
  boosterType: string;
  status: DraftStatusName;
  hostName: string;
  seats: number;
  maxSeats: number;
  entryFee: Cents;
  secondsPerPick: number | null;
  createdAt: string;
  finishedAt: string | null;
  youAreSeated: boolean;
  /** Your deck from this draft, once it's finished. */
  deckId: number | null;
}>;

type SummaryRow = {
  id: number;
  set_code: string;
  set_name: string;
  keyrune_code: string;
  booster_type: string;
  status: DraftStatusName;
  host_name: string;
  seats: number;
  max_seats: number;
  entry_fee_cents: number;
  seconds_per_pick: number | null;
  created_at: Date;
  finished_at: Date | null;
  seated: boolean;
  deck_id: number | null;
};

const SUMMARY_COLUMNS = (userId: UserId) => sql`
  d.id, d.set_code, s.name as set_name, s.keyrune_code, d.booster_type, d.status,
  h.name as host_name, d.max_seats, d.entry_fee_cents, d.seconds_per_pick, d.created_at,
  d.finished_at,
  (select count(*)::int from draft_seats x where x.draft_id = d.id) as seats,
  exists (select 1 from draft_seats x where x.draft_id = d.id and x.user_id = ${userId}) as seated,
  (select x.deck_id from draft_seats x where x.draft_id = d.id and x.user_id = ${userId}) as deck_id`;

function toSummary(row: SummaryRow): DraftSummary {
  return {
    id: Number(row.id),
    setCode: row.set_code,
    setName: row.set_name,
    keyruneCode: row.keyrune_code,
    boosterType: row.booster_type,
    status: row.status,
    hostName: row.host_name,
    seats: row.seats,
    maxSeats: row.max_seats,
    entryFee: Cents.of(Number(row.entry_fee_cents)),
    secondsPerPick: row.seconds_per_pick,
    createdAt: new Date(row.created_at).toISOString(),
    finishedAt: row.finished_at === null ? null : new Date(row.finished_at).toISOString(),
    youAreSeated: row.seated,
    deckId: row.deck_id === null ? null : Number(row.deck_id),
  };
}

export type DraftsOverview = Readonly<{
  /** Open lobbies anyone can join, and drafts running now (yours first). */
  open: DraftSummary[];
  /** Drafts you finished, newest first. */
  finished: DraftSummary[];
}>;

export async function draftsOverview(db: DbExecutor, userId: UserId): Promise<DraftsOverview> {
  const open = await db.execute<SummaryRow>(sql`
    select ${SUMMARY_COLUMNS(userId)}
      from drafts d
      join card_sets s on s.code = d.set_code
      join auth_users h on h.id = d.host_id
     where d.status in ('lobby', 'drafting')
     order by seated desc, d.status = 'lobby' desc, d.created_at desc
  `);
  const finished = await db.execute<SummaryRow>(sql`
    select ${SUMMARY_COLUMNS(userId)}
      from drafts d
      join card_sets s on s.code = d.set_code
      join auth_users h on h.id = d.host_id
     where d.status = 'finished'
       and exists (select 1 from draft_seats x where x.draft_id = d.id and x.user_id = ${userId})
     order by d.finished_at desc
     limit 20
  `);
  return { open: open.rows.map(toSummary), finished: finished.rows.map(toSummary) };
}

/** The lobby or draft you're seated at, for the header's reminder, or null. */
export async function activeDraftOf(
  db: DbExecutor,
  userId: UserId,
): Promise<{ id: number; status: DraftStatusName } | null> {
  const rows = await db.execute<{ id: number; status: DraftStatusName }>(sql`
    select d.id, d.status
      from draft_seats x join drafts d on d.id = x.draft_id
     where x.user_id = ${userId} and x.is_active
     limit 1
  `);
  const row = rows.rows[0];
  return row === undefined ? null : { id: Number(row.id), status: row.status };
}

export type DraftableBooster = Readonly<{
  setCode: string;
  setName: string;
  keyruneCode: string;
  boosterType: string;
}>;

/**
 * Every enabled set's draft booster, newest set first: one per set, preferring the Play Booster,
 * then the Draft Booster, then an older set's only booster.
 */
export async function draftableBoosters(db: DbExecutor): Promise<DraftableBooster[]> {
  const rows = await db.execute<{
    set_code: string;
    set_name: string;
    keyrune_code: string;
    booster_type: string;
  }>(sql`
    select distinct on (s.release_date, s.code)
           s.code as set_code, s.name as set_name, s.keyrune_code, b.booster_type
      from booster_configs b
      join card_sets s on s.code = b.set_code
     where s.is_enabled
       and b.booster_type = any(${sql.param([...DRAFTABLE_BOOSTER_TYPES])}::text[])
     order by s.release_date desc, s.code,
              array_position(${sql.param([...DRAFTABLE_BOOSTER_TYPES])}::text[], b.booster_type)
  `);
  return rows.rows.map((row) => ({
    setCode: row.set_code,
    setName: row.set_name,
    keyruneCode: row.keyrune_code,
    boosterType: row.booster_type,
  }));
}

/** A draft's version, for a browser that has just connected to the live updates. */
export async function draftVersion(db: DbExecutor, draftId: number): Promise<number | null> {
  const rows = await db.execute<{ version: number }>(
    sql`select version from drafts where id = ${draftId}`,
  );
  return rows.rows[0] === undefined ? null : Number(rows.rows[0].version);
}

export type SeatView = Readonly<{
  seatNumber: number;
  name: string;
  isHost: boolean;
  isYou: boolean;
  /** Packs waiting in front of this seat this round. */
  waiting: number;
  picks: number;
  deadline: string | null;
  away: boolean;
}>;

export type CardInPack = Readonly<{ slot: number; printingId: string; finish: string }>;

export type PickedCard = Readonly<{
  printingId: string;
  finish: string;
  pickNumber: number;
  round: number;
  auto: boolean;
}>;

export type YourSeat = Readonly<{
  seatNumber: number;
  /** The pack in front of you, or null while you wait. */
  pack: Readonly<{ packNumber: number; cards: CardInPack[] }> | null;
  picks: PickedCard[];
  deckId: number | null;
}>;

export type DraftView = Readonly<{
  id: number;
  setCode: string;
  setName: string;
  keyruneCode: string;
  boosterType: string;
  status: DraftStatusName;
  isHost: boolean;
  hostName: string;
  maxSeats: number;
  entryFee: Cents;
  secondsPerPick: number | null;
  round: number;
  packsPerPlayer: number;
  passDirection: "left" | "right";
  version: number;
  seats: SeatView[];
  /** Null when you're watching, not seated. */
  you: YourSeat | null;
}>;

/** One draft as `userId` may see it at `now` (rule 13). */
export async function draftView(
  db: DbExecutor,
  draftId: number,
  userId: UserId,
  now: Date,
): Promise<DraftView | null> {
  const drafts = await db.execute<{
    id: number;
    set_code: string;
    set_name: string;
    keyrune_code: string;
    booster_type: string;
    status: DraftStatusName;
    host_id: string;
    host_name: string;
    max_seats: number;
    entry_fee_cents: number;
    seconds_per_pick: number | null;
    round: number;
    style: string;
    version: number;
  }>(sql`
    select d.id, d.set_code, s.name as set_name, s.keyrune_code, d.booster_type, d.status,
           d.host_id, h.name as host_name, d.max_seats, d.entry_fee_cents, d.seconds_per_pick,
           d.round, d.style, d.version
      from drafts d
      join card_sets s on s.code = d.set_code
      join auth_users h on h.id = d.host_id
     where d.id = ${draftId}
  `);
  const draft = drafts.rows[0];
  if (draft === undefined) return null;

  const seats = await db.execute<{
    seat_number: number;
    user_id: string;
    name: string;
    deadline: Date | null;
    last_seen_at: Date | null;
    deck_id: number | null;
    waiting: number;
    picks: number;
  }>(sql`
    select x.seat_number, x.user_id, u.name, x.deadline, x.last_seen_at, x.deck_id,
           (select count(*)::int
              from draft_packs p
             where p.draft_id = x.draft_id and p.round = ${draft.round}
               and p.holder_seat = x.seat_number
               and exists (select 1 from draft_cards c
                            where c.draft_id = p.draft_id and c.pack_number = p.pack_number
                              and c.picked_by_seat is null)) as waiting,
           (select count(*)::int from draft_cards c
             where c.draft_id = x.draft_id and c.picked_by_seat = x.seat_number) as picks
      from draft_seats x
      join auth_users u on u.id = x.user_id
     where x.draft_id = ${draftId}
     order by x.seat_number
  `);

  const awayBefore = now.getTime() - AWAY_AFTER_SECONDS * 1000;
  const mine = seats.rows.find((seat) => seat.user_id === userId);
  const style = DRAFT_STYLES[DRAFT_STYLE_NAMES.find((name) => name === draft.style) ?? "booster"];
  return {
    id: Number(draft.id),
    setCode: draft.set_code,
    setName: draft.set_name,
    keyruneCode: draft.keyrune_code,
    boosterType: draft.booster_type,
    status: draft.status,
    isHost: draft.host_id === userId,
    hostName: draft.host_name,
    maxSeats: draft.max_seats,
    entryFee: Cents.of(Number(draft.entry_fee_cents)),
    secondsPerPick: draft.seconds_per_pick,
    round: draft.round,
    packsPerPlayer: style.packsPerPlayer,
    passDirection: style.passDirection(Math.max(1, draft.round)),
    version: Number(draft.version),
    seats: seats.rows.map((seat) => ({
      seatNumber: seat.seat_number,
      name: seat.name,
      isHost: seat.user_id === draft.host_id,
      isYou: seat.user_id === userId,
      waiting: draft.status === "drafting" ? seat.waiting : 0,
      picks: seat.picks,
      deadline: seat.deadline === null ? null : new Date(seat.deadline).toISOString(),
      away: seat.last_seen_at === null || new Date(seat.last_seen_at).getTime() < awayBefore,
    })),
    you:
      mine === undefined
        ? null
        : await yourSeat(db, draftId, draft.status, draft.round, mine.seat_number, mine.deck_id),
  };
}

async function yourSeat(
  db: DbExecutor,
  draftId: number,
  status: DraftStatusName,
  round: number,
  seatNumber: number,
  deckId: number | null,
): Promise<YourSeat> {
  let pack: YourSeat["pack"] = null;
  if (status === "drafting") {
    // The front of your queue: the earliest-arrived pack of this round with cards left.
    const front = await db.execute<{ pack_number: number }>(sql`
      select p.pack_number
        from draft_packs p
       where p.draft_id = ${draftId} and p.round = ${round} and p.holder_seat = ${seatNumber}
         and exists (select 1 from draft_cards c
                      where c.draft_id = p.draft_id and c.pack_number = p.pack_number
                        and c.picked_by_seat is null)
       order by p.queue_position
       limit 1
    `);
    const packNumber = front.rows[0]?.pack_number;
    if (packNumber !== undefined) {
      const cards = await db.execute<{ slot: number; printing_id: string; finish: string }>(sql`
        select slot, printing_id, finish from draft_cards
         where draft_id = ${draftId} and pack_number = ${packNumber} and picked_by_seat is null
         order by slot
      `);
      pack = {
        packNumber: Number(packNumber),
        cards: cards.rows.map((card) => ({
          slot: card.slot,
          printingId: card.printing_id,
          finish: card.finish,
        })),
      };
    }
  }
  const picks = await db.execute<{
    printing_id: string;
    finish: string;
    pick_number: number;
    round: number;
    picked_auto: boolean;
  }>(sql`
    select c.printing_id, c.finish, c.pick_number, p.round, c.picked_auto
      from draft_cards c
      join draft_packs p on p.draft_id = c.draft_id and p.pack_number = c.pack_number
     where c.draft_id = ${draftId} and c.picked_by_seat = ${seatNumber}
     order by c.pick_number
  `);
  return {
    seatNumber,
    pack,
    picks: picks.rows.map((pick) => ({
      printingId: pick.printing_id,
      finish: pick.finish,
      pickNumber: pick.pick_number,
      round: pick.round,
      auto: pick.picked_auto,
    })),
    deckId: deckId === null ? null : Number(deckId),
  };
}
