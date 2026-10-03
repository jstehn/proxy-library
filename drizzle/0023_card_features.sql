ALTER TABLE "printings" ADD COLUMN "role_tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "theme_tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "printings" ADD COLUMN "features_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "printings_role_tags_idx" ON "printings" USING gin ("role_tags");--> statement-breakpoint
CREATE INDEX "printings_theme_tags_idx" ON "printings" USING gin ("theme_tags");--> statement-breakpoint
CREATE INDEX "printings_features_version_idx" ON "printings" USING btree ("features_version");