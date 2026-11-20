ALTER TABLE "card_features" ADD COLUMN "theme_tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "card_features" ADD COLUMN "leader_themes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "card_features_theme_tags_idx" ON "card_features" USING gin ("theme_tags");--> statement-breakpoint
-- Keep what the printings already say until the features pass works every card out again
-- (FEATURES_VERSION 3): one printing's themes stand for the oracle card's. `leader_themes` is new
-- and fills only when the pass runs.
UPDATE "card_features" f SET "theme_tags" = coalesce((SELECT p."theme_tags" FROM "printings" p WHERE p."oracle_id" = f."oracle_id" ORDER BY p."id" LIMIT 1), '{}'::text[]);--> statement-breakpoint
-- DROPS A COLUMN: printings.theme_tags and its index move to card_features (design doc 66).
DROP INDEX "printings_theme_tags_idx";--> statement-breakpoint
ALTER TABLE "printings" DROP COLUMN "theme_tags";
