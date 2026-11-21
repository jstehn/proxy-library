ALTER TABLE "card_features" ADD COLUMN "bracket_flags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "card_features_bracket_flags_idx" ON "card_features" USING gin ("bracket_flags");--> statement-breakpoint
-- Keep what the printings already say until the features pass works every card out again
-- (FEATURES_VERSION 4): one printing's text flags stand for the oracle card's.
UPDATE "card_features" f SET "bracket_flags" = coalesce((SELECT p."bracket_flags" FROM "printings" p WHERE p."oracle_id" = f."oracle_id" ORDER BY p."id" LIMIT 1), '{}'::text[]);--> statement-breakpoint
-- DROPS COLUMNS: printings.bracket_flags and printings.features_version (the old tag pass is gone:
-- the features pass versions every card's features in card_features), with their indexes.
DROP INDEX "printings_bracket_flags_idx";--> statement-breakpoint
DROP INDEX "printings_features_version_idx";--> statement-breakpoint
ALTER TABLE "printings" DROP COLUMN "bracket_flags";--> statement-breakpoint
ALTER TABLE "printings" DROP COLUMN "features_version";
