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
  },
  (table) => [
    index("drafts_status_idx").on(table.status),
    check(
      "drafts_status_known",
      sql`${table.status} in ('lobby', 'drafting', 'finished', 'cancelled')`,
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
  },
  (table) => [
    primaryKey({ columns: [table.draftId, table.packNumber, table.slot] }),
    check(
      "draft_cards_pick_complete",
      sql`(${table.pickedBySeat} is null) = (${table.pickNumber} is null) and (${table.pickNumber} is null) = (${table.pickedAt} is null)`,
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
