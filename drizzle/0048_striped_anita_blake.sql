ALTER TABLE "deck_entries" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "deck_entries" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "profile_json" jsonb;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "primer" text;--> statement-breakpoint
ALTER TABLE "deck_entries" ADD CONSTRAINT "deck_entries_role_length" CHECK ("deck_entries"."role" is null or char_length("deck_entries"."role") between 1 and 160);