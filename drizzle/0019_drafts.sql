CREATE TABLE "draft_cards" (
	"draft_id" bigint NOT NULL,
	"pack_number" integer NOT NULL,
	"slot" integer NOT NULL,
	"printing_id" text NOT NULL,
	"finish" text NOT NULL,
	"picked_by_seat" integer,
	"pick_number" integer,
	"picked_auto" boolean DEFAULT false NOT NULL,
	"picked_at" timestamp with time zone,
	CONSTRAINT "draft_cards_draft_id_pack_number_slot_pk" PRIMARY KEY("draft_id","pack_number","slot"),
	CONSTRAINT "draft_cards_pick_complete" CHECK (("draft_cards"."picked_by_seat" is null) = ("draft_cards"."pick_number" is null) and ("draft_cards"."pick_number" is null) = ("draft_cards"."picked_at" is null))
);
--> statement-breakpoint
CREATE TABLE "draft_packs" (
	"draft_id" bigint NOT NULL,
	"pack_number" integer NOT NULL,
	"round" integer NOT NULL,
	"opened_by_seat" integer NOT NULL,
	"seed" text NOT NULL,
	"holder_seat" integer NOT NULL,
	"queue_position" integer NOT NULL,
	CONSTRAINT "draft_packs_draft_id_pack_number_pk" PRIMARY KEY("draft_id","pack_number")
);
--> statement-breakpoint
CREATE TABLE "draft_seats" (
	"draft_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"seat_number" integer NOT NULL,
	"fee_paid_cents" bigint NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"pack_source" text NOT NULL,
	"deadline" timestamp with time zone,
	"deadline_pack" integer,
	"grace_used_seconds" integer NOT NULL,
	"last_seen_at" timestamp with time zone,
	"is_active" boolean NOT NULL,
	"deck_id" bigint,
	CONSTRAINT "draft_seats_draft_id_user_id_pk" PRIMARY KEY("draft_id","user_id"),
	CONSTRAINT "draft_seats_pack_source_known" CHECK ("draft_seats"."pack_source" in ('entryFee'))
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"set_code" text NOT NULL,
	"booster_type" text NOT NULL,
	"style" text NOT NULL,
	"status" text NOT NULL,
	"max_seats" integer NOT NULL,
	"seconds_per_pick" integer,
	"entry_fee_cents" bigint NOT NULL,
	"round" integer NOT NULL,
	"sequence" integer NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "drafts_status_known" CHECK ("drafts"."status" in ('lobby', 'drafting', 'finished', 'cancelled')),
	CONSTRAINT "drafts_style_known" CHECK ("drafts"."style" in ('booster')),
	CONSTRAINT "drafts_seats" CHECK ("drafts"."max_seats" between 2 and 8),
	CONSTRAINT "drafts_timer" CHECK ("drafts"."seconds_per_pick" is null or "drafts"."seconds_per_pick" between 30 and 300),
	CONSTRAINT "drafts_fee" CHECK ("drafts"."entry_fee_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "acquisitions" DROP CONSTRAINT "acquisitions_source_known";--> statement-breakpoint
ALTER TABLE "decks" DROP CONSTRAINT "decks_format_known";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_kind_known";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_direction";--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "draft_cards" ADD CONSTRAINT "draft_cards_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_cards" ADD CONSTRAINT "draft_cards_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_packs" ADD CONSTRAINT "draft_packs_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_seats" ADD CONSTRAINT "draft_seats_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_seats" ADD CONSTRAINT "draft_seats_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_seats" ADD CONSTRAINT "draft_seats_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_host_id_players_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_set_code_card_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."card_sets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_seats_one_active_idx" ON "draft_seats" USING btree ("user_id") WHERE "draft_seats"."is_active";--> statement-breakpoint
CREATE INDEX "draft_seats_deadline_idx" ON "draft_seats" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "drafts_status_idx" ON "drafts" USING btree ("status");--> statement-breakpoint
ALTER TABLE "acquisitions" ADD CONSTRAINT "acquisitions_source_known" CHECK ("acquisitions"."source" in ('pack', 'deck', 'product', 'store', 'sale', 'trade', 'reset', 'draft'));--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_format_known" CHECK ("decks"."format" in ('casual', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'limited'));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_kind_known" CHECK ("ledger_entries"."kind" in ('starting_grant', 'allowance', 'grant', 'correction', 'self_fund', 'purchase_sealed', 'purchase_single', 'sellback', 'trade_in', 'trade_out', 'draft_entry', 'draft_refund'));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_direction" CHECK (("ledger_entries"."kind" in ('correction', 'purchase_sealed', 'purchase_single', 'trade_out', 'draft_entry')) = ("ledger_entries"."amount_cents" < 0));