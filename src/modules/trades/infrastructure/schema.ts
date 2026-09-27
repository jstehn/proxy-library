// Tables owned by the trades module (design doc 10, section 8).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";
import { printings } from "../../catalog/infrastructure/schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const trades = pgTable(
  "trades",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    proposerId: text("proposer_id")
      .notNull()
      .references(() => players.userId),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => players.userId),
    status: text("status").notNull(),
    message: text("message").notNull(),
    replacesId: bigint("replaces_id", { mode: "number" }).references((): AnyPgColumn => trades.id),
    createdAt: timestamptz("created_at").notNull(),
    decidedAt: timestamptz("decided_at"),
  },
  (table) => [
    index("trades_proposer_idx").on(table.proposerId, table.status),
    index("trades_recipient_idx").on(table.recipientId, table.status),
    check(
      "trades_status_known",
      sql`${table.status} in ('proposed', 'accepted', 'declined', 'cancelled', 'countered')`,
    ),
    check("trades_not_with_yourself", sql`${table.proposerId} <> ${table.recipientId}`),
    check("trades_decided_at", sql`(${table.status} = 'proposed') = (${table.decidedAt} is null)`),
  ],
);

export const tradeItems = pgTable(
  "trade_items",
  {
    tradeId: bigint("trade_id", { mode: "number" })
      .notNull()
      .references(() => trades.id),
    position: integer("position").notNull(),
    fromSide: text("from_side").notNull(), // "proposer" | "recipient"
    kind: text("kind").notNull(), // "card" | "money"
    printingId: text("printing_id").references(() => printings.id),
    finish: text("finish"),
    quantity: integer("quantity"),
    amountCents: bigint("amount_cents", { mode: "number" }),
  },
  (table) => [
    primaryKey({ columns: [table.tradeId, table.position] }),
    check("trade_items_side_known", sql`${table.fromSide} in ('proposer', 'recipient')`),
    check(
      "trade_items_shape",
      sql`(${table.kind} = 'card' and ${table.printingId} is not null and ${table.finish} is not null
            and ${table.quantity} between 1 and 99 and ${table.amountCents} is null)
       or (${table.kind} = 'money' and ${table.amountCents} between 1 and 1000000
            and ${table.printingId} is null and ${table.quantity} is null)`,
    ),
  ],
);
