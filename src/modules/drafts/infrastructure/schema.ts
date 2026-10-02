// Tables owned by the drafts module (design doc 17, section 8).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";
import { cardSets, printings } from "../../catalog/infrastructure/schema";
import { decks } from "../../decks/infrastructure/schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const drafts = pgTable(
  "drafts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    hostId: text("host_id")
      .notNull()
      .references(() => players.userId),
    setCode: text("set_code")
      .notNull()
      .references(() => cardSets.code),
    boosterType: text("booster_type").notNull(),
    style: text("style").notNull(),
    status: text("status").notNull(),
    maxSeats: integer("max_seats").notNull(),
    secondsPerPick: integer("seconds_per_pick"), // null: no pick timer
    entryFeeCents: bigint("entry_fee_cents", { mode: "number" }).notNull(),
    round: integer("round").notNull(),
    sequence: integer("sequence").notNull(), // the next queue position to hand out
    version: integer("version").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
    /** Illusionary Informant watches (PlayerWatch[]). */
    watches: jsonb("watches").notNull().default([]),
    /** Deal Broker exchanges after the draft (Deals), or null. */
    deals: jsonb("deals"),
    /** The current deal step's deadline, for the worker to find. */
    dealDeadline: timestamptz("deal_deadline"),
  },
  (table) => [
    index("drafts_status_idx").on(table.status),
    check(
      "drafts_status_known",
      sql`${table.status} in ('lobby', 'drafting', 'dealing', 'finished', 'cancelled')`,
    ),
    check("drafts_style_known", sql`${table.style} in ('booster')`),
    check("drafts_seats", sql`${table.maxSeats} between 2 and 8`),
    check(
      "drafts_timer",
      sql`${table.secondsPerPick} is null or ${table.secondsPerPick} between 30 and 300`,
    ),
    check("drafts_fee", sql`${table.entryFeeCents} >= 0`),
  ],
);

export const draftSeats = pgTable(
  "draft_seats",
  {
    draftId: bigint("draft_id", { mode: "number" })
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => players.userId),
    /** 0 for a person; 1, 2, … for the bots an admin added (user_id is then that admin). */
    botNumber: integer("bot_number").notNull().default(0),
    seatNumber: integer("seat_number").notNull(),
    feePaidCents: bigint("fee_paid_cents", { mode: "number" }).notNull(),
    joinedAt: timestamptz("joined_at").notNull(),
    packSource: text("pack_source").notNull(), // "entryFee"; "ownPacks" later
    deadline: timestamptz("deadline"),
    deadlinePack: integer("deadline_pack"),
    deadlinePick: integer("deadline_pick"),
    /** When an owed color choice (Paliano, Regicide) is made for the seat. */
    promptDeadline: timestamptz("prompt_deadline"),
    /** Draft-ability state (SeatAbilities): skips, lockout, a turn in progress, … */
    abilities: jsonb("abilities").notNull().default({}),
    graceUsedSeconds: integer("grace_used_seconds").notNull(),
    lastSeenAt: timestamptz("last_seen_at"),
    /** True while the draft is a lobby or running: rule 1 as a unique index. */
    isActive: boolean("is_active").notNull(),
    deckId: bigint("deck_id", { mode: "number" }).references(() => decks.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    primaryKey({ columns: [table.draftId, table.userId, table.botNumber] }),
    // One unfinished draft per player (rule 1), even if two joins race each other. Bots don't
    // count: they belong to the admin who added them, who is seated too.
    uniqueIndex("draft_seats_one_active_idx")
      .on(table.userId)
      .where(sql`${table.isActive} and ${table.botNumber} = 0`),
    check("draft_seats_bot_number", sql`${table.botNumber} >= 0`),
    // The worker looks for passed deadlines every few seconds.
    index("draft_seats_deadline_idx").on(table.deadline),
    index("draft_seats_prompt_deadline_idx").on(table.promptDeadline),
    check("draft_seats_pack_source_known", sql`${table.packSource} in ('entryFee')`),
  ],
);

export const draftPacks = pgTable(
  "draft_packs",
  {
    draftId: bigint("draft_id", { mode: "number" })
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    packNumber: integer("pack_number").notNull(),
    round: integer("round").notNull(),
    openedBySeat: integer("opened_by_seat").notNull(),
    seed: text("seed").notNull(),
    holderSeat: integer("holder_seat").notNull(),
    queuePosition: integer("queue_position").notNull(),
    lastPassedBy: integer("last_passed_by"),
    /** The seat that added it with a Lore Seeker, or null. */
    addedBy: integer("added_by"),
    /** Who waits for the next card drafted from it (PackWatcher[]). */
    watchers: jsonb("watchers").notNull().default([]),
  },
  (table) => [primaryKey({ columns: [table.draftId, table.packNumber] })],
);

export const draftCards = pgTable(
  "draft_cards",
  {
    draftId: bigint("draft_id", { mode: "number" })
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    packNumber: integer("pack_number").notNull(),
    slot: integer("slot").notNull(),
    printingId: text("printing_id")
      .notNull()
      .references(() => printings.id),
    finish: text("finish").notNull(),
    pickedBySeat: integer("picked_by_seat"),
    pickNumber: integer("pick_number"),
    pickedAuto: boolean("picked_auto").notNull().default(false),
    pickedAt: timestamptz("picked_at"),
    pickRound: integer("pick_round"),
    pickedRandom: boolean("picked_random").notNull().default(false),
    /** faceDown | faceUp | removedFaceDown | removedFaceUp | returned (design doc 18). */
    pickState: text("pick_state"),
    /** Whose card pool it's in (a Deal Broker swap can change it). */
    poolSeat: integer("pool_seat"),
    /** What was noted for it (Note[]): public (CR 905.2b). */
    notes: jsonb("notes").notNull().default([]),
    /** A Cogwork Librarian put into this pack: where it was before ({ packNumber, slot }). */
    cameFrom: jsonb("came_from"),
  },
  (table) => [
    primaryKey({ columns: [table.draftId, table.packNumber, table.slot] }),
    check(
      "draft_cards_pick_complete",
      sql`(${table.pickedBySeat} is null) = (${table.pickNumber} is null) and (${table.pickNumber} is null) = (${table.pickedAt} is null)`,
    ),
    check(
      "draft_cards_pick_state_known",
      sql`${table.pickState} is null or ${table.pickState} in ('faceDown', 'faceUp', 'removedFaceDown', 'removedFaceUp', 'returned')`,
    ),
  ],
);

/** Basic lands taken out of the packs and dealt to the players (design doc 17, rule 15). */
export const draftBasics = pgTable(
  "draft_basics",
  {
    draftId: bigint("draft_id", { mode: "number" })
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => players.userId),
    printingId: text("printing_id")
      .notNull()
      .references(() => printings.id),
    finish: text("finish").notNull(),
  },
  (table) => [primaryKey({ columns: [table.draftId, table.position] })],
);

/** Everything shown during a draft, in order (design doc 18, section 4). */
export const draftReveals = pgTable(
  "draft_reveals",
  {
    draftId: bigint("draft_id", { mode: "number" })
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    at: timestamptz("at").notNull(),
    /** The one seat that may see it, or null for everyone. */
    audience: integer("audience"),
    seat: integer("seat").notNull(),
    kind: text("kind").notNull(),
    /** [{ printingId, finish }] */
    cards: jsonb("cards").notNull(),
    /** The card whose ability caused it ({ packNumber, slot }), or null. */
    about: jsonb("about"),
  },
  (table) => [primaryKey({ columns: [table.draftId, table.position] })],
);
