ALTER TABLE "card_features" ADD COLUMN "role_tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "card_features_role_tags_idx" ON "card_features" USING gin ("role_tags");--> statement-breakpoint
-- Keep what the printings already say until the features pass works every card out again
-- (FEATURES_VERSION 2): one printing's tags stand for the oracle card's.
UPDATE "card_features" f SET "role_tags" = coalesce((SELECT p."role_tags" FROM "printings" p WHERE p."oracle_id" = f."oracle_id" ORDER BY p."id" LIMIT 1), '{}'::text[]);--> statement-breakpoint
-- DROPS A COLUMN: printings.role_tags and its index move to card_features (design doc 66).
DROP INDEX "printings_role_tags_idx";--> statement-breakpoint
ALTER TABLE "printings" DROP COLUMN "role_tags";
