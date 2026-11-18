CREATE TABLE "deck_sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deck_id" bigint NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"used_for" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_entries" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "deck_sources" ADD CONSTRAINT "deck_sources_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deck_sources_deck_idx" ON "deck_sources" USING btree ("deck_id");