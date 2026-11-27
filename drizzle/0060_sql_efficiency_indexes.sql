CREATE INDEX "printings_lower_back_name_idx" ON "printings" USING btree (lower(split_part("name", ' // ', 2))) WHERE "printings"."name" like '% // %';--> statement-breakpoint
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_stat_statements; EXCEPTION WHEN OTHERS THEN NULL; END $$;
