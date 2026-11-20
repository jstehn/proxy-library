ALTER TABLE "card_features" ADD COLUMN "land_cycles" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "card_features_land_cycles_idx" ON "card_features" USING gin ("land_cycles");