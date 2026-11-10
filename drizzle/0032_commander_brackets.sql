ALTER TABLE "printings" ADD COLUMN "bracket_flags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "is_game_changer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "target_bracket" smallint;--> statement-breakpoint
CREATE INDEX "printings_bracket_flags_idx" ON "printings" USING gin ("bracket_flags");--> statement-breakpoint
CREATE INDEX "printings_game_changer_idx" ON "printings" USING btree ("is_game_changer") WHERE "printings"."is_game_changer";--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_target_bracket" CHECK ("decks"."target_bracket" is null or ("decks"."target_bracket" between 1 and 5 and "decks"."format" = 'commander'));