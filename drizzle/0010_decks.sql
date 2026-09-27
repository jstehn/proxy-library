CREATE TABLE "deck_entries" (
	"deck_id" bigint NOT NULL,
	"oracle_id" text NOT NULL,
	"board" text NOT NULL,
	"quantity" integer NOT NULL,
	"printing_id" text,
	"finish" text,
	CONSTRAINT "deck_entries_deck_id_oracle_id_board_pk" PRIMARY KEY("deck_id","oracle_id","board"),
	CONSTRAINT "deck_entries_board_known" CHECK ("deck_entries"."board" in ('commander', 'main', 'side')),
	CONSTRAINT "deck_entries_quantity" CHECK ("deck_entries"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decks_format_known" CHECK ("decks"."format" in ('casual', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander'))
);
--> statement-breakpoint
ALTER TABLE "deck_entries" ADD CONSTRAINT "deck_entries_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_entries" ADD CONSTRAINT "deck_entries_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_owner_id_players_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deck_entries_oracle_idx" ON "deck_entries" USING btree ("oracle_id");--> statement-breakpoint
CREATE INDEX "decks_owner_idx" ON "decks" USING btree ("owner_id");