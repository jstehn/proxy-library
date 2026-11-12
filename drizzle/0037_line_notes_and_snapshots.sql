ALTER TABLE "deck_entries" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "deck_entries" ADD CONSTRAINT "deck_entries_note_length" CHECK ("deck_entries"."note" is null or char_length("deck_entries"."note") between 1 and 200);--> statement-breakpoint
CREATE TABLE "deck_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deck_id" bigint NOT NULL REFERENCES "decks"("id") ON DELETE CASCADE,
	"label" text NOT NULL,
	"format" text NOT NULL,
	"target_bracket" smallint,
	"grouping" text DEFAULT 'type' NOT NULL,
	"heading_order" text[] DEFAULT '{}'::text[] NOT NULL,
	"entries" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deck_snapshots_label_length" CHECK (char_length("label") between 1 and 60),
	CONSTRAINT "deck_snapshots_grouping_known" CHECK ("grouping" in ('type', 'custom')),
	CONSTRAINT "deck_snapshots_target_bracket" CHECK ("target_bracket" is null or ("target_bracket" between 1 and 5 and "format" = 'commander')),
	CONSTRAINT "deck_snapshots_format_known" CHECK ("format" in ('casual', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'limited'))
);--> statement-breakpoint
CREATE INDEX "deck_snapshots_deck_idx" ON "deck_snapshots" USING btree ("deck_id","created_at");
