CREATE TABLE "card_features" (
	"oracle_id" text PRIMARY KEY NOT NULL,
	"features" jsonb NOT NULL,
	"features_version" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "card_features_version_idx" ON "card_features" USING btree ("features_version");