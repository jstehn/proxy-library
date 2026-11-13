// Tables owned by the social module (design doc 48, section 8).
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
// Relative imports (not "@/…") because drizzle-kit loads this file outside the app.
import { players } from "../../accounts/infrastructure/schema";
import { decks } from "../../decks/infrastructure/schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const playerProfiles = pgTable(
  "player_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => players.userId, { onDelete: "cascade" }),
    bio: text("bio").notNull().default(""),
    favoriteColors: text("favorite_colors")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    favoriteFormats: text("favorite_formats")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    showcaseDeckId: bigint("showcase_deck_id", { mode: "number" }).references(() => decks.id, {
      onDelete: "set null",
    }),
    showcasePrintingIds: text("showcase_printing_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    statsVisibility: text("stats_visibility").notNull().default("everyone"),
    wishlistVisibility: text("wishlist_visibility").notNull().default("friends"),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check("player_profiles_bio_length", sql`char_length(${table.bio}) <= 500`),
    check(
      "player_profiles_showcase_cards_max",
      sql`cardinality(${table.showcasePrintingIds}) <= 3`,
    ),
    check(
      "player_profiles_stats_visibility_known",
      sql`${table.statsVisibility} in ('everyone', 'friends', 'only_me')`,
    ),
    check(
      "player_profiles_wishlist_visibility_known",
      sql`${table.wishlistVisibility} in ('everyone', 'friends', 'only_me')`,
    ),
  ],
);

export const friendships = pgTable(
  "friendships",
  {
    requesterId: text("requester_id")
      .notNull()
      .references(() => players.userId, { onDelete: "cascade" }),
    addresseeId: text("addressee_id")
      .notNull()
      .references(() => players.userId, { onDelete: "cascade" }),
    status: text("status").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    acceptedAt: timestamptz("accepted_at"),
  },
  (table) => [
    primaryKey({ columns: [table.requesterId, table.addresseeId] }),
    check("friendships_not_self", sql`${table.requesterId} <> ${table.addresseeId}`),
    check("friendships_status_known", sql`${table.status} in ('pending', 'accepted')`),
    check(
      "friendships_accepted_at",
      sql`(${table.status} = 'accepted') = (${table.acceptedAt} is not null)`,
    ),
    uniqueIndex("friendships_pair_idx").on(
      sql`least(${table.requesterId}, ${table.addresseeId})`,
      sql`greatest(${table.requesterId}, ${table.addresseeId})`,
    ),
    index("friendships_addressee_pending_idx")
      .on(table.addresseeId)
      .where(sql`${table.status} = 'pending'`),
  ],
);
