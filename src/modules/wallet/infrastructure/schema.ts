// Tables owned by the wallet module. drizzle-kit reads this file to generate migrations.
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
// A relative import (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
// Money columns: bigint in Postgres, a plain number of cents in TypeScript.
const cents = (name: string) => bigint(name, { mode: "number" });

export const walletAccounts = pgTable("wallet_accounts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => players.userId),
  allowancePaidThrough: timestamptz("allowance_paid_through").notNull(),
  openedAt: timestamptz("opened_at").notNull(),
});

/** The ledger: rows are only ever inserted (design doc 03, rule 1). */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => walletAccounts.userId),
    amountCents: cents("amount_cents").notNull(),
    kind: text("kind").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => players.userId),
    effectiveAt: timestamptz("effective_at").notNull(),
    ref: text("ref"), // what the money was for in another module, e.g. "store:42"
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
  },
  (table) => [
    index("ledger_entries_user_effective_idx").on(table.userId, table.effectiveAt.desc()),
    // The database double-checks the rules the code already enforces.
    check("ledger_entries_amount_nonzero", sql`${table.amountCents} <> 0`),
    check(
      "ledger_entries_kind_known",
      sql`${table.kind} in ('starting_grant', 'allowance', 'grant', 'correction', 'self_fund', 'purchase_sealed', 'purchase_single', 'sellback')`,
    ),
    // Rule 4: corrections and purchases take money away; every other kind adds it.
    check(
      "ledger_entries_direction",
      sql`(${table.kind} in ('correction', 'purchase_sealed', 'purchase_single')) = (${table.amountCents} < 0)`,
    ),
  ],
);

/** Exactly one row (id = 1), seeded by a migration with the defaults. */
export const economySettings = pgTable(
  "economy_settings",
  {
    id: smallint("id").primaryKey(),
    allowanceCents: cents("allowance_cents").notNull(),
    allowancePeriodDays: integer("allowance_period_days").notNull(),
    allowanceAnchor: timestamptz("allowance_anchor").notNull(),
    startingGrantCents: cents("starting_grant_cents").notNull(),
    selfFundLimitCents: cents("self_fund_limit_cents").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    // Deliberately no foreign key: emptying `players` (as tests do) must not delete the settings.
    updatedBy: text("updated_by"),
  },
  (table) => [check("economy_settings_single_row", sql`${table.id} = 1`)],
);
