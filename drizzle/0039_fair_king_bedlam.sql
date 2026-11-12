ALTER TABLE "decks" ADD COLUMN "public_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "decks_public_token_idx" ON "decks" USING btree ("public_token");