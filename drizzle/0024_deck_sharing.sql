CREATE TABLE "deck_comments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deck_id" bigint NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	CONSTRAINT "deck_comments_body_length" CHECK (("deck_comments"."deleted_at" is not null and "deck_comments"."body" = '') or char_length("deck_comments"."body") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "first_shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deck_comments" ADD CONSTRAINT "deck_comments_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_comments" ADD CONSTRAINT "deck_comments_author_id_players_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_comments" ADD CONSTRAINT "deck_comments_deleted_by_players_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."players"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deck_comments_deck_idx" ON "deck_comments" USING btree ("deck_id","created_at");--> statement-breakpoint
CREATE INDEX "decks_visibility_idx" ON "decks" USING btree ("visibility");--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_visibility_known" CHECK ("decks"."visibility" in ('private', 'shared'));