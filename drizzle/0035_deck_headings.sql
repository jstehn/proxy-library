ALTER TABLE "deck_entries" ADD COLUMN "heading" text;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "grouping" text DEFAULT 'type' NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "heading_order" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "deck_entries" ADD CONSTRAINT "deck_entries_heading_length" CHECK ("deck_entries"."heading" is null or char_length("deck_entries"."heading") between 1 and 40);--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_grouping_known" CHECK ("decks"."grouping" in ('type', 'custom'));