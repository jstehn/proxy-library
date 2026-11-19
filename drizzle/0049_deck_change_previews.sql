CREATE TABLE "deck_change_previews" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deck_id" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"changes" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_change_previews" ADD CONSTRAINT "deck_change_previews_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_change_previews" ADD CONSTRAINT "deck_change_previews_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deck_change_previews_expires_idx" ON "deck_change_previews" USING btree ("expires_at");