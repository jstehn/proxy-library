CREATE TABLE IF NOT EXISTS "edhrec_commander_cards" (
	"commander_oracle_id" text NOT NULL,
	"card_oracle_id" text NOT NULL,
	"inclusion_rate" double precision NOT NULL,
	"synergy" double precision NOT NULL,
	CONSTRAINT "edhrec_commander_cards_commander_oracle_id_card_oracle_id_pk" PRIMARY KEY("commander_oracle_id","card_oracle_id"),
	CONSTRAINT "edhrec_inclusion_range" CHECK ("edhrec_commander_cards"."inclusion_rate" >= 0 and "edhrec_commander_cards"."inclusion_rate" <= 1),
	CONSTRAINT "edhrec_synergy_range" CHECK ("edhrec_commander_cards"."synergy" >= -1 and "edhrec_commander_cards"."synergy" <= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "edhrec_commanders" (
	"commander_oracle_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"status" text NOT NULL,
	"total_decks" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deck_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deck_id" bigint NOT NULL,
	"label" text NOT NULL,
	"format" text NOT NULL,
	"target_bracket" smallint,
	"grouping" text DEFAULT 'type' NOT NULL,
	"heading_order" text[] DEFAULT '{}'::text[] NOT NULL,
	"entries" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deck_snapshots_label_length" CHECK (char_length("deck_snapshots"."label") between 1 and 60),
	CONSTRAINT "deck_snapshots_grouping_known" CHECK ("deck_snapshots"."grouping" in ('type', 'custom')),
	CONSTRAINT "deck_snapshots_target_bracket" CHECK ("deck_snapshots"."target_bracket" is null or ("deck_snapshots"."target_bracket" between 1 and 5 and "deck_snapshots"."format" = 'commander')),
	CONSTRAINT "deck_snapshots_format_known" CHECK ("deck_snapshots"."format" in ('casual', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'limited'))
);
--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN IF NOT EXISTS "edhrec_rank" integer;--> statement-breakpoint
ALTER TABLE "deck_entries" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "edhrec_commander_cards" ADD CONSTRAINT "edhrec_commander_cards_commander_oracle_id_edhrec_commanders_commander_oracle_id_fk" FOREIGN KEY ("commander_oracle_id") REFERENCES "public"."edhrec_commanders"("commander_oracle_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "deck_snapshots" ADD CONSTRAINT "deck_snapshots_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edhrec_commander_cards_synergy_idx" ON "edhrec_commander_cards" USING btree ("commander_oracle_id","synergy");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deck_snapshots_deck_idx" ON "deck_snapshots" USING btree ("deck_id","created_at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "deck_entries" ADD CONSTRAINT "deck_entries_note_length" CHECK ("deck_entries"."note" is null or char_length("deck_entries"."note") between 1 and 200);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
