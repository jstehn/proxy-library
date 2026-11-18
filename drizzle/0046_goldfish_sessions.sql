CREATE TABLE "goldfish_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deck_id" bigint NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goldfish_sessions" ADD CONSTRAINT "goldfish_sessions_user_id_players_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."players"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goldfish_sessions" ADD CONSTRAINT "goldfish_sessions_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goldfish_sessions_expires_idx" ON "goldfish_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "goldfish_sessions_user_idx" ON "goldfish_sessions" USING btree ("user_id","updated_at");