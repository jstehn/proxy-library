// Tables owned by the accounts module. drizzle-kit reads this file to generate migrations.
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

// --- Better Auth's tables (ADR 0012) --------------------------------------------------------
// Written only by Better Auth. The property names (emailVerified, userId, ...) must match
// Better Auth's field names; the SQL names are ours, prefixed with auth_.

export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(), // the display name
  email: text("email").notNull().unique(), // placeholder: <username>@players.invalid
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  username: text("username").unique(), // username plugin: normalized (lowercase)
  displayUsername: text("display_username"), // username plugin: as typed
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamptz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [index("auth_sessions_user_id_idx").on(table.userId)],
);

/** Better Auth's "account" = one way to sign in (for us: always username + password). */
export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamptz("access_token_expires_at"),
    refreshTokenExpiresAt: timestamptz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"), // scrypt hash, never the password itself
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [index("auth_accounts_user_id_idx").on(table.userId)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

// --- Our tables --------------------------------------------------------------------------------

export const players = pgTable("players", {
  userId: text("user_id")
    .primaryKey()
    .references(() => authUsers.id),
  isAdmin: boolean("is_admin").notNull().default(false),
  canSelfFund: boolean("can_self_fund").notNull().default(false),
  disabledAt: timestamptz("disabled_at"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamptz("created_at").notNull(),
});

export const invites = pgTable("invites", {
  code: text("code").primaryKey(),
  createdBy: text("created_by")
    .notNull()
    .references(() => players.userId),
  createdAt: timestamptz("created_at").notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
  usedBy: text("used_by")
    .unique()
    .references(() => players.userId),
  usedAt: timestamptz("used_at"),
  revokedAt: timestamptz("revoked_at"),
});
