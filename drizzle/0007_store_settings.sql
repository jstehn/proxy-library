CREATE TABLE "store_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"buylist_rate_bps" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text,
	CONSTRAINT "store_settings_single_row" CHECK ("store_settings"."id" = 1),
	CONSTRAINT "store_settings_rate" CHECK ("store_settings"."buylist_rate_bps" between 0 and 10000)
);
